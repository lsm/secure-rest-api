import type { Context, MiddlewareHandler } from 'hono';
import { RateLimiter, type RateLimiterConfig } from './limiter.ts';

export interface RateLimitMiddlewareOptions extends RateLimiterConfig {
	/**
	 * Derive the rate-limit key from the request context.
	 * Defaults to the `X-Forwarded-For` header, falling back to a static fallback key.
	 */
	keyGenerator?: (c: Context) => string;

	/** Custom message included in 429 responses. */
	message?: string;

	/**
	 * Skip rate limiting for certain requests (e.g. internal health checks).
	 * Returning true bypasses the limiter.
	 */
	skip?: (c: Context) => boolean;

	/**
	 * Reuse an existing RateLimiter instance instead of creating a new one.
	 * Useful when you want multiple routes to share the same counter store.
	 */
	limiter?: RateLimiter;
}

/** Default key: client IP from X-Forwarded-For or cf-connecting-ip, else fallback. */
export function defaultKeyGenerator(c: Context): string {
	return (
		c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
		c.req.header('cf-connecting-ip') ??
		'unknown'
	);
}

/**
 * Create a rate-limiting Hono middleware.
 *
 * On allowed requests the following headers are set:
 *   X-RateLimit-Limit     – maximum requests per window
 *   X-RateLimit-Remaining – requests remaining in current window
 *   X-RateLimit-Reset     – Unix timestamp (seconds) when the window resets
 *
 * On rejected requests a 429 JSON response is returned with a Retry-After header.
 */
export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions): MiddlewareHandler {
	const limiter =
		options.limiter ??
		new RateLimiter({ windowMs: options.windowMs, max: options.max });

	const keyGen = options.keyGenerator ?? defaultKeyGenerator;
	const message = options.message ?? 'Too many requests, please try again later.';

	return async (c, next) => {
		if (options.skip?.(c)) {
			await next();
			return;
		}

		const key = keyGen(c);
		const result = limiter.check(key);

		const resetSecs = Math.ceil(result.resetAt / 1000);

		c.header('X-RateLimit-Limit', String(result.total));
		c.header('X-RateLimit-Remaining', String(result.remaining));
		c.header('X-RateLimit-Reset', String(resetSecs));

		if (!result.allowed) {
			const retryAfterSecs = Math.ceil((result.resetAt - Date.now()) / 1000);
			c.header('Retry-After', String(Math.max(retryAfterSecs, 1)));
			return c.json(
				{
					error: message,
					code: 'RATE_LIMIT_EXCEEDED',
					retryAfter: Math.max(retryAfterSecs, 1),
				},
				429,
			);
		}

		await next();
	};
}

// ---------------------------------------------------------------------------
// Pre-configured limiters for common scenarios
// ---------------------------------------------------------------------------

/**
 * Strict limiter for authentication endpoints (login, signup, password reset).
 * 5 attempts per 15 minutes per IP.
 */
export function createAuthRateLimiter(overrides?: Partial<RateLimitMiddlewareOptions>): MiddlewareHandler {
	return createRateLimitMiddleware({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: 5,
		message: 'Too many authentication attempts, please try again later.',
		...overrides,
	});
}

/**
 * Standard limiter for general API endpoints.
 * 100 requests per 15 minutes per IP.
 */
export function createApiRateLimiter(overrides?: Partial<RateLimitMiddlewareOptions>): MiddlewareHandler {
	return createRateLimitMiddleware({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: 100,
		message: 'Too many requests, please try again later.',
		...overrides,
	});
}

/**
 * Key generator that uses the authenticated user's ID when available,
 * falling back to the IP address for unauthenticated requests.
 */
export function userOrIpKeyGenerator(c: Context): string {
	try {
		const user = c.get('user' as never) as { sub?: string } | undefined;
		if (user?.sub) return `user:${user.sub}`;
	} catch {
		// c.get may throw if 'user' is not set – fall through to IP
	}
	return defaultKeyGenerator(c);
}
