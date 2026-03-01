import { describe, test, expect, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import { RateLimiter } from '../src/rate-limit/limiter.ts';
import {
	createRateLimitMiddleware,
	createAuthRateLimiter,
	createApiRateLimiter,
	defaultKeyGenerator,
	userOrIpKeyGenerator,
} from '../src/rate-limit/middleware.ts';

// ---------------------------------------------------------------------------
// RateLimiter unit tests
// ---------------------------------------------------------------------------

describe('RateLimiter', () => {
	describe('constructor validation', () => {
		test('throws when windowMs is 0', () => {
			expect(() => new RateLimiter({ windowMs: 0, max: 5 })).toThrow('windowMs must be positive');
		});

		test('throws when windowMs is negative', () => {
			expect(() => new RateLimiter({ windowMs: -1000, max: 5 })).toThrow(
				'windowMs must be positive',
			);
		});

		test('throws when max is 0', () => {
			expect(() => new RateLimiter({ windowMs: 1000, max: 0 })).toThrow('max must be positive');
		});

		test('throws when max is negative', () => {
			expect(() => new RateLimiter({ windowMs: 1000, max: -1 })).toThrow('max must be positive');
		});

		test('creates instance with valid config', () => {
			expect(() => new RateLimiter({ windowMs: 1000, max: 5 })).not.toThrow();
		});
	});

	describe('check()', () => {
		let limiter: RateLimiter;

		beforeEach(() => {
			limiter = new RateLimiter({ windowMs: 1000, max: 3 });
		});

		test('allows first request', () => {
			const result = limiter.check('ip1');
			expect(result.allowed).toBe(true);
			expect(result.remaining).toBe(2);
			expect(result.total).toBe(3);
		});

		test('decrements remaining on each request', () => {
			const r1 = limiter.check('ip1');
			expect(r1.remaining).toBe(2);
			const r2 = limiter.check('ip1');
			expect(r2.remaining).toBe(1);
			const r3 = limiter.check('ip1');
			expect(r3.remaining).toBe(0);
		});

		test('blocks request once limit is reached', () => {
			limiter.check('ip1');
			limiter.check('ip1');
			limiter.check('ip1');
			const r4 = limiter.check('ip1');
			expect(r4.allowed).toBe(false);
			expect(r4.remaining).toBe(0);
		});

		test('tracks keys independently', () => {
			limiter.check('ip1');
			limiter.check('ip1');
			limiter.check('ip1');

			// ip2 should have its own counter
			const r = limiter.check('ip2');
			expect(r.allowed).toBe(true);
			expect(r.remaining).toBe(2);
		});

		test('resetAt is in the future when requests remain', () => {
			const before = Date.now();
			const result = limiter.check('ip1');
			expect(result.resetAt).toBeGreaterThan(before);
		});

		test('resetAt on blocked response is the time the oldest request expires', () => {
			limiter.check('ip1');
			limiter.check('ip1');
			limiter.check('ip1');
			const blocked = limiter.check('ip1');
			// resetAt should be at most windowMs ms from now
			expect(blocked.resetAt).toBeGreaterThan(Date.now() - 10);
			expect(blocked.resetAt).toBeLessThanOrEqual(Date.now() + 1000 + 10);
		});

		test('allows requests after window expires', async () => {
			// Use a very short window
			const shortLimiter = new RateLimiter({ windowMs: 50, max: 1 });
			shortLimiter.check('ip1'); // use up the 1 slot
			const blocked = shortLimiter.check('ip1');
			expect(blocked.allowed).toBe(false);

			// Wait for window to pass
			await Bun.sleep(60);

			const allowed = shortLimiter.check('ip1');
			expect(allowed.allowed).toBe(true);
		});
	});

	describe('reset()', () => {
		test('resets counter for a specific key', () => {
			const limiter = new RateLimiter({ windowMs: 1000, max: 2 });
			limiter.check('ip1');
			limiter.check('ip1');
			expect(limiter.check('ip1').allowed).toBe(false);

			limiter.reset('ip1');
			expect(limiter.check('ip1').allowed).toBe(true);
		});

		test('only resets the specified key', () => {
			const limiter = new RateLimiter({ windowMs: 1000, max: 2 });
			limiter.check('ip1');
			limiter.check('ip1');
			limiter.check('ip2');

			limiter.reset('ip1');

			// ip1 should be reset
			expect(limiter.check('ip1').allowed).toBe(true);
			// ip2 should still have 1 used
			expect(limiter.check('ip2').remaining).toBe(0);
		});
	});

	describe('cleanup()', () => {
		test('removes entries with fully expired timestamps', async () => {
			const limiter = new RateLimiter({ windowMs: 30, max: 5 });
			limiter.check('ip1');
			limiter.check('ip2');
			expect(limiter.size).toBe(2);

			await Bun.sleep(40);
			limiter.cleanup();

			expect(limiter.size).toBe(0);
		});

		test('preserves entries with live timestamps', async () => {
			const limiter = new RateLimiter({ windowMs: 200, max: 5 });
			limiter.check('ip1'); // will still be live after 50ms
			limiter.check('ip2');

			await Bun.sleep(50);
			limiter.cleanup();

			expect(limiter.size).toBe(2);
		});
	});

	describe('startCleanup() / stopCleanup()', () => {
		test('calling startCleanup twice does not create two intervals', () => {
			const limiter = new RateLimiter({ windowMs: 1000, max: 5 });
			// Should not throw
			limiter.startCleanup(50);
			limiter.startCleanup(50);
			limiter.stopCleanup();
		});

		test('stopCleanup is idempotent', () => {
			const limiter = new RateLimiter({ windowMs: 1000, max: 5 });
			limiter.startCleanup(50);
			limiter.stopCleanup();
			expect(() => limiter.stopCleanup()).not.toThrow();
		});
	});
});

// ---------------------------------------------------------------------------
// Middleware integration tests
// ---------------------------------------------------------------------------

function makeApp(windowMs: number, max: number, ip = '1.2.3.4') {
	const app = new Hono();
	app.use(
		'/api/*',
		createRateLimitMiddleware({
			windowMs,
			max,
			keyGenerator: () => ip,
		}),
	);
	app.get('/api/resource', (c) => c.json({ ok: true }));
	return app;
}

describe('createRateLimitMiddleware', () => {
	test('returns 200 for request within limit', async () => {
		const app = makeApp(5000, 5);
		const res = await app.request('/api/resource');
		expect(res.status).toBe(200);
	});

	test('sets X-RateLimit headers on allowed request', async () => {
		const app = makeApp(5000, 5);
		const res = await app.request('/api/resource');
		expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
		expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
		expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
	});

	test('returns 429 after limit is exceeded', async () => {
		const app = makeApp(5000, 3);
		await app.request('/api/resource');
		await app.request('/api/resource');
		await app.request('/api/resource');
		const res = await app.request('/api/resource');
		expect(res.status).toBe(429);
	});

	test('429 response includes correct error body', async () => {
		const app = makeApp(5000, 1);
		await app.request('/api/resource');
		const res = await app.request('/api/resource');
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
		expect(body.error).toBeTruthy();
		expect(typeof body.retryAfter).toBe('number');
		expect(body.retryAfter).toBeGreaterThan(0);
	});

	test('429 response includes Retry-After header', async () => {
		const app = makeApp(5000, 1);
		await app.request('/api/resource');
		const res = await app.request('/api/resource');
		const retryAfter = res.headers.get('Retry-After');
		expect(retryAfter).toBeTruthy();
		expect(Number(retryAfter)).toBeGreaterThan(0);
	});

	test('429 response sets X-RateLimit-Remaining to 0', async () => {
		const app = makeApp(5000, 1);
		await app.request('/api/resource');
		const res = await app.request('/api/resource');
		expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
	});

	test('different keys get independent counters', async () => {
		const app = new Hono();
		let callCount = 0;
		app.use(
			'/api/*',
			createRateLimitMiddleware({
				windowMs: 5000,
				max: 1,
				keyGenerator: () => `ip${++callCount > 1 ? '2' : '1'}`,
			}),
		);
		app.get('/api/resource', (c) => c.json({ ok: true }));

		// First call: ip1 — allowed
		const r1 = await app.request('/api/resource');
		expect(r1.status).toBe(200);

		// Second call: ip2 (different key) — also allowed
		const r2 = await app.request('/api/resource');
		expect(r2.status).toBe(200);
	});

	test('custom error message is used in 429 body', async () => {
		const app = new Hono();
		app.use(
			'/api/*',
			createRateLimitMiddleware({
				windowMs: 5000,
				max: 1,
				message: 'Custom limit message',
				keyGenerator: () => 'key',
			}),
		);
		app.get('/api/resource', (c) => c.json({ ok: true }));

		await app.request('/api/resource');
		const res = await app.request('/api/resource');
		const body = await res.json();
		expect(body.error).toBe('Custom limit message');
	});

	test('skip function bypasses rate limiting', async () => {
		const app = new Hono();
		app.use(
			'/api/*',
			createRateLimitMiddleware({
				windowMs: 5000,
				max: 1,
				keyGenerator: () => 'key',
				skip: () => true,
			}),
		);
		app.get('/api/resource', (c) => c.json({ ok: true }));

		await app.request('/api/resource');
		// With max=1 but skip=true, second request should still pass
		const res = await app.request('/api/resource');
		expect(res.status).toBe(200);
	});

	test('shared limiter instance coordinates across routes', async () => {
		const shared = new RateLimiter({ windowMs: 5000, max: 2 });
		const app = new Hono();

		const mw = createRateLimitMiddleware({
			windowMs: 5000,
			max: 2,
			limiter: shared,
			keyGenerator: () => 'shared-key',
		});

		app.use('/route-a', mw);
		app.use('/route-b', mw);
		app.get('/route-a', (c) => c.json({ route: 'a' }));
		app.get('/route-b', (c) => c.json({ route: 'b' }));

		const r1 = await app.request('/route-a');
		expect(r1.status).toBe(200);
		const r2 = await app.request('/route-b');
		expect(r2.status).toBe(200);
		// Third request hits the shared cap of 2
		const r3 = await app.request('/route-a');
		expect(r3.status).toBe(429);
	});

	test('allows requests again after window expires', async () => {
		const app = new Hono();
		app.use(
			'/api/*',
			createRateLimitMiddleware({
				windowMs: 50,
				max: 1,
				keyGenerator: () => 'key',
			}),
		);
		app.get('/api/resource', (c) => c.json({ ok: true }));

		await app.request('/api/resource'); // use up limit
		const blocked = await app.request('/api/resource');
		expect(blocked.status).toBe(429);

		await Bun.sleep(60); // wait for window to expire

		const allowed = await app.request('/api/resource');
		expect(allowed.status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// Pre-configured middleware tests
// ---------------------------------------------------------------------------

describe('createAuthRateLimiter', () => {
	test('allows 5 requests then blocks the 6th', async () => {
		const app = new Hono();
		app.use('/auth/*', createAuthRateLimiter({ keyGenerator: () => 'test-ip' }));
		app.post('/auth/login', (c) => c.json({ ok: true }));

		for (let i = 0; i < 5; i++) {
			const res = await app.request('/auth/login', { method: 'POST' });
			expect(res.status).toBe(200);
		}
		const res = await app.request('/auth/login', { method: 'POST' });
		expect(res.status).toBe(429);
	});

	test('X-RateLimit-Limit is 5', async () => {
		const app = new Hono();
		app.use('/auth/*', createAuthRateLimiter({ keyGenerator: () => 'test-ip' }));
		app.post('/auth/login', (c) => c.json({ ok: true }));

		const res = await app.request('/auth/login', { method: 'POST' });
		expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
	});
});

describe('createApiRateLimiter', () => {
	test('allows 100 requests then blocks the 101st', async () => {
		const app = new Hono();
		app.use('/api/*', createApiRateLimiter({ keyGenerator: () => 'test-ip' }));
		app.get('/api/data', (c) => c.json({ ok: true }));

		for (let i = 0; i < 100; i++) {
			const res = await app.request('/api/data');
			expect(res.status).toBe(200);
		}
		const res = await app.request('/api/data');
		expect(res.status).toBe(429);
	});

	test('X-RateLimit-Limit is 100', async () => {
		const app = new Hono();
		app.use('/api/*', createApiRateLimiter({ keyGenerator: () => 'test-ip' }));
		app.get('/api/data', (c) => c.json({ ok: true }));

		const res = await app.request('/api/data');
		expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
	});
});

// ---------------------------------------------------------------------------
// Key generator tests
// ---------------------------------------------------------------------------

describe('defaultKeyGenerator', () => {
	test('extracts IP from X-Forwarded-For header', async () => {
		const keys: string[] = [];
		const app = new Hono();
		app.use('/*', (c, next) => {
			keys.push(defaultKeyGenerator(c));
			return next();
		});
		app.get('/ping', (c) => c.json({ ok: true }));

		await app.request('/ping', {
			headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
		});

		expect(keys[0]).toBe('10.0.0.1');
	});

	test('uses cf-connecting-ip when x-forwarded-for is absent', async () => {
		const keys: string[] = [];
		const app = new Hono();
		app.use('/*', (c, next) => {
			keys.push(defaultKeyGenerator(c));
			return next();
		});
		app.get('/ping', (c) => c.json({ ok: true }));

		await app.request('/ping', {
			headers: { 'cf-connecting-ip': '1.2.3.4' },
		});

		expect(keys[0]).toBe('1.2.3.4');
	});

	test('falls back to "unknown" when no IP headers are present', async () => {
		const keys: string[] = [];
		const app = new Hono();
		app.use('/*', (c, next) => {
			keys.push(defaultKeyGenerator(c));
			return next();
		});
		app.get('/ping', (c) => c.json({ ok: true }));

		await app.request('/ping');

		expect(keys[0]).toBe('unknown');
	});
});

describe('userOrIpKeyGenerator', () => {
	test('uses user.sub when user is set in context', async () => {
		const keys: string[] = [];
		const app = new Hono();
		// Simulate auth middleware setting the user
		app.use('/*', (c, next) => {
			c.set('user' as never, { sub: 'user-42', email: 'a@b.com', role: 'user' });
			return next();
		});
		app.use('/*', (c, next) => {
			keys.push(userOrIpKeyGenerator(c));
			return next();
		});
		app.get('/ping', (c) => c.json({ ok: true }));

		await app.request('/ping');

		expect(keys[0]).toBe('user:user-42');
	});

	test('falls back to IP when user is not in context', async () => {
		const keys: string[] = [];
		const app = new Hono();
		app.use('/*', (c, next) => {
			keys.push(userOrIpKeyGenerator(c));
			return next();
		});
		app.get('/ping', (c) => c.json({ ok: true }));

		await app.request('/ping', {
			headers: { 'x-forwarded-for': '5.6.7.8' },
		});

		expect(keys[0]).toBe('5.6.7.8');
	});
});
