import type { Context, Next } from 'hono';
import { verifyAccessToken, type AccessTokenPayload } from './tokens.ts';

export interface AuthContext {
	user: AccessTokenPayload;
}

declare module 'hono' {
	interface ContextVariableMap {
		user: AccessTokenPayload;
	}
}

export function extractBearerToken(authHeader: string | undefined): string | null {
	if (!authHeader) return null;
	const parts = authHeader.split(' ');
	if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
	return parts[1];
}

export function createAuthMiddleware(jwtSecret: string) {
	return async (c: Context, next: Next) => {
		const authHeader = c.req.header('Authorization');
		const token = extractBearerToken(authHeader);

		if (!token) {
			return c.json(
				{ error: 'Missing authorization header', code: 'UNAUTHORIZED' },
				401,
			);
		}

		try {
			const payload = await verifyAccessToken(token, jwtSecret);
			c.set('user', payload);
			await next();
		} catch {
			return c.json(
				{ error: 'Invalid or expired token', code: 'UNAUTHORIZED' },
				401,
			);
		}
	};
}

export function createRoleMiddleware(...allowedRoles: string[]) {
	return async (c: Context, next: Next) => {
		const user = c.get('user');

		if (!user) {
			return c.json(
				{ error: 'Unauthorized', code: 'UNAUTHORIZED' },
				401,
			);
		}

		if (!allowedRoles.includes(user.role)) {
			return c.json(
				{ error: 'Insufficient permissions', code: 'FORBIDDEN' },
				403,
			);
		}

		await next();
	};
}

export function createOptionalAuthMiddleware(jwtSecret: string) {
	return async (c: Context, next: Next) => {
		const authHeader = c.req.header('Authorization');
		const token = extractBearerToken(authHeader);

		if (token) {
			try {
				const payload = await verifyAccessToken(token, jwtSecret);
				c.set('user', payload);
			} catch {
				// Silently ignore invalid tokens for optional auth
			}
		}

		await next();
	};
}
