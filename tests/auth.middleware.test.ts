import { describe, test, expect, beforeEach } from 'bun:test';
import { Hono } from 'hono';
import {
	extractBearerToken,
	createAuthMiddleware,
	createRoleMiddleware,
	createOptionalAuthMiddleware,
} from '../src/auth/middleware.ts';
import { signAccessToken } from '../src/auth/tokens.ts';

const TEST_SECRET = 'test-jwt-secret-that-is-long-enough-for-hs256';

async function makeToken(
	payload: { sub: string; email: string; role: string } = {
		sub: 'user-1',
		email: 'test@example.com',
		role: 'user',
	},
): Promise<string> {
	return signAccessToken(payload, TEST_SECRET);
}

describe('extractBearerToken', () => {
	test('extracts token from valid Bearer header', () => {
		expect(extractBearerToken('Bearer mytoken123')).toBe('mytoken123');
	});

	test('is case-insensitive for "bearer" prefix', () => {
		expect(extractBearerToken('BEARER mytoken')).toBe('mytoken');
		expect(extractBearerToken('bearer mytoken')).toBe('mytoken');
		expect(extractBearerToken('Bearer mytoken')).toBe('mytoken');
	});

	test('returns null for undefined input', () => {
		expect(extractBearerToken(undefined)).toBeNull();
	});

	test('returns null for empty string', () => {
		expect(extractBearerToken('')).toBeNull();
	});

	test('returns null for non-Bearer auth scheme', () => {
		expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
		expect(extractBearerToken('ApiKey mykey')).toBeNull();
	});

	test('returns null for malformed header with no space', () => {
		expect(extractBearerToken('Bearertoken')).toBeNull();
	});

	test('returns null for header with extra parts', () => {
		// "Bearer token extra" has 3 parts - should fail
		expect(extractBearerToken('Bearer token extra')).toBeNull();
	});
});

describe('createAuthMiddleware', () => {
	let app: Hono;

	beforeEach(() => {
		app = new Hono();
		app.use('/protected/*', createAuthMiddleware(TEST_SECRET));
		app.get('/protected/resource', (c) => {
			const user = c.get('user');
			return c.json({ userId: user.sub, email: user.email });
		});
	});

	test('allows request with valid token', async () => {
		const token = await makeToken();
		const res = await app.request('/protected/resource', {
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.userId).toBe('user-1');
		expect(body.email).toBe('test@example.com');
	});

	test('sets user context from token payload', async () => {
		const token = await makeToken({ sub: 'admin-1', email: 'admin@example.com', role: 'admin' });
		const res = await app.request('/protected/resource', {
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.userId).toBe('admin-1');
		expect(body.email).toBe('admin@example.com');
	});

	test('returns 401 when Authorization header is missing', async () => {
		const res = await app.request('/protected/resource');
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.code).toBe('UNAUTHORIZED');
	});

	test('returns 401 for invalid token', async () => {
		const res = await app.request('/protected/resource', {
			headers: { Authorization: 'Bearer invalid.token.here' },
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.code).toBe('UNAUTHORIZED');
	});

	test('returns 401 for token signed with wrong secret', async () => {
		const token = await signAccessToken(
			{ sub: 'u1', email: 'a@b.com', role: 'user' },
			'wrong-secret',
		);
		const res = await app.request('/protected/resource', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(401);
	});

	test('returns 401 for non-Bearer scheme', async () => {
		const res = await app.request('/protected/resource', {
			headers: { Authorization: 'Basic dXNlcjpwYXNz' },
		});
		expect(res.status).toBe(401);
	});
});

describe('createRoleMiddleware', () => {
	let app: Hono;

	beforeEach(() => {
		app = new Hono();
		app.use('/admin/*', createAuthMiddleware(TEST_SECRET));
		app.use('/admin/*', createRoleMiddleware('admin'));
		app.get('/admin/dashboard', (c) => c.json({ ok: true }));

		app.use('/multi/*', createAuthMiddleware(TEST_SECRET));
		app.use('/multi/*', createRoleMiddleware('admin', 'moderator'));
		app.get('/multi/resource', (c) => c.json({ ok: true }));
	});

	test('allows admin to access admin route', async () => {
		const token = await makeToken({ sub: 'a1', email: 'admin@example.com', role: 'admin' });
		const res = await app.request('/admin/dashboard', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
	});

	test('blocks non-admin user from admin route', async () => {
		const token = await makeToken({ sub: 'u1', email: 'user@example.com', role: 'user' });
		const res = await app.request('/admin/dashboard', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.code).toBe('FORBIDDEN');
	});

	test('allows any listed role in multi-role middleware', async () => {
		const adminToken = await makeToken({ sub: 'a1', email: 'admin@example.com', role: 'admin' });
		const modToken = await makeToken({ sub: 'm1', email: 'mod@example.com', role: 'moderator' });

		const resAdmin = await app.request('/multi/resource', {
			headers: { Authorization: `Bearer ${adminToken}` },
		});
		expect(resAdmin.status).toBe(200);

		const resMod = await app.request('/multi/resource', {
			headers: { Authorization: `Bearer ${modToken}` },
		});
		expect(resMod.status).toBe(200);
	});

	test('blocks role not in allowed list', async () => {
		const token = await makeToken({ sub: 'u1', email: 'user@example.com', role: 'user' });
		const res = await app.request('/multi/resource', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});

	test('returns 401 when used without auth middleware (no user in context)', async () => {
		// createRoleMiddleware without createAuthMiddleware - user will be undefined
		const standaloneApp = new Hono();
		standaloneApp.use('/standalone/*', createRoleMiddleware('admin'));
		standaloneApp.get('/standalone/resource', (c) => c.json({ ok: true }));

		const res = await standaloneApp.request('/standalone/resource');
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.code).toBe('UNAUTHORIZED');
	});
});

describe('createOptionalAuthMiddleware', () => {
	let app: Hono;

	beforeEach(() => {
		app = new Hono();
		app.use('/public/*', createOptionalAuthMiddleware(TEST_SECRET));
		app.get('/public/resource', (c) => {
			const user = c.get('user');
			if (user) {
				return c.json({ authenticated: true, userId: user.sub });
			}
			return c.json({ authenticated: false });
		});
	});

	test('sets user context when valid token provided', async () => {
		const token = await makeToken();
		const res = await app.request('/public/resource', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.authenticated).toBe(true);
		expect(body.userId).toBe('user-1');
	});

	test('continues without user context when no token provided', async () => {
		const res = await app.request('/public/resource');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.authenticated).toBe(false);
	});

	test('continues without user context when invalid token provided', async () => {
		const res = await app.request('/public/resource', {
			headers: { Authorization: 'Bearer invalid.token.here' },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.authenticated).toBe(false);
	});

	test('continues without user context when wrong secret used', async () => {
		const token = await signAccessToken(
			{ sub: 'u1', email: 'a@b.com', role: 'user' },
			'wrong-secret',
		);
		const res = await app.request('/public/resource', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.authenticated).toBe(false);
	});
});
