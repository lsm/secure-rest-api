import { describe, test, expect, beforeEach } from 'bun:test';
import { AuthService, AuthError } from '../src/auth/service.ts';
import { InMemoryDb } from '../src/db/schema.ts';
import { verifyAccessToken, verifyRefreshToken, hashToken } from '../src/auth/tokens.ts';

const TEST_SECRET = 'test-jwt-secret-that-is-long-enough-for-hs256';

function createService(db: InMemoryDb) {
	return new AuthService({ jwtSecret: TEST_SECRET, db });
}

describe('AuthService.signup', () => {
	let db: InMemoryDb;
	let service: AuthService;

	beforeEach(() => {
		db = new InMemoryDb();
		service = createService(db);
	});

	test('successfully creates a new user', async () => {
		const result = await service.signup({
			email: 'alice@example.com',
			password: 'StrongPass1!',
			name: 'Alice',
		});

		expect(result.user.email).toBe('alice@example.com');
		expect(result.user.name).toBe('Alice');
		expect(result.user.role).toBe('user');
		expect(result.user.is_active).toBe(true);
		expect(result.user.id).toBeTruthy();
		expect(result.user).not.toHaveProperty('password_hash');
	});

	test('normalizes email to lowercase', async () => {
		const result = await service.signup({
			email: 'Alice@Example.COM',
			password: 'StrongPass1!',
			name: 'Alice',
		});
		expect(result.user.email).toBe('alice@example.com');
	});

	test('trims whitespace from name', async () => {
		const result = await service.signup({
			email: 'alice@example.com',
			password: 'StrongPass1!',
			name: '  Alice  ',
		});
		expect(result.user.name).toBe('Alice');
	});

	test('returns access and refresh tokens', async () => {
		const result = await service.signup({
			email: 'bob@example.com',
			password: 'StrongPass1!',
			name: 'Bob',
		});

		expect(result.tokens.accessToken).toBeTruthy();
		expect(result.tokens.refreshToken).toBeTruthy();
		expect(result.tokens.expiresIn).toBe(900);
	});

	test('access token contains correct user info', async () => {
		const result = await service.signup({
			email: 'carol@example.com',
			password: 'StrongPass1!',
			name: 'Carol',
		});

		const payload = await verifyAccessToken(result.tokens.accessToken, TEST_SECRET);
		expect(payload.sub).toBe(result.user.id);
		expect(payload.email).toBe('carol@example.com');
		expect(payload.role).toBe('user');
		expect(payload.type).toBe('access');
	});

	test('stores user in database', async () => {
		const result = await service.signup({
			email: 'dave@example.com',
			password: 'StrongPass1!',
			name: 'Dave',
		});

		const dbUser = db.findUserByEmail('dave@example.com');
		expect(dbUser).toBeDefined();
		expect(dbUser!.id).toBe(result.user.id);
	});

	test('stores hashed password (not plaintext)', async () => {
		await service.signup({
			email: 'eve@example.com',
			password: 'StrongPass1!',
			name: 'Eve',
		});

		const dbUser = db.findUserByEmail('eve@example.com');
		expect(dbUser!.password_hash).not.toBe('StrongPass1!');
		expect(dbUser!.password_hash.length).toBeGreaterThan(20);
	});

	test('creates a session record', async () => {
		await service.signup({
			email: 'frank@example.com',
			password: 'StrongPass1!',
			name: 'Frank',
		});

		expect(db.sessions.size).toBe(1);
	});

	test('throws AuthError for invalid email', async () => {
		await expect(
			service.signup({ email: 'not-an-email', password: 'StrongPass1!', name: 'X' }),
		).rejects.toThrow(AuthError);

		try {
			await service.signup({ email: 'not-an-email', password: 'StrongPass1!', name: 'X' });
		} catch (e) {
			if (e instanceof AuthError) {
				expect(e.code).toBe('INVALID_EMAIL');
				expect(e.statusCode).toBe(400);
			}
		}
	});

	test('throws AuthError for weak password', async () => {
		await expect(
			service.signup({ email: 'test@example.com', password: 'weak', name: 'X' }),
		).rejects.toThrow(AuthError);

		try {
			await service.signup({ email: 'test@example.com', password: 'weak', name: 'X' });
		} catch (e) {
			if (e instanceof AuthError) {
				expect(e.code).toBe('WEAK_PASSWORD');
			}
		}
	});

	test('throws AuthError with 409 when email already registered', async () => {
		await service.signup({
			email: 'dup@example.com',
			password: 'StrongPass1!',
			name: 'User1',
		});

		try {
			await service.signup({
				email: 'dup@example.com',
				password: 'StrongPass1!',
				name: 'User2',
			});
			expect(true).toBe(false); // should not reach here
		} catch (e) {
			expect(e).toBeInstanceOf(AuthError);
			if (e instanceof AuthError) {
				expect(e.code).toBe('EMAIL_IN_USE');
				expect(e.statusCode).toBe(409);
			}
		}
	});

	test('email uniqueness check is case-insensitive', async () => {
		await service.signup({
			email: 'unique@example.com',
			password: 'StrongPass1!',
			name: 'User1',
		});

		await expect(
			service.signup({
				email: 'UNIQUE@EXAMPLE.COM',
				password: 'StrongPass1!',
				name: 'User2',
			}),
		).rejects.toThrow(AuthError);
	});
});

describe('AuthService.login', () => {
	let db: InMemoryDb;
	let service: AuthService;

	beforeEach(async () => {
		db = new InMemoryDb();
		service = createService(db);
		// Pre-register a user
		await service.signup({
			email: 'alice@example.com',
			password: 'StrongPass1!',
			name: 'Alice',
		});
	});

	test('successfully logs in with correct credentials', async () => {
		const result = await service.login({
			email: 'alice@example.com',
			password: 'StrongPass1!',
		});

		expect(result.user.email).toBe('alice@example.com');
		expect(result.tokens.accessToken).toBeTruthy();
		expect(result.tokens.refreshToken).toBeTruthy();
	});

	test('is case-insensitive for email', async () => {
		const result = await service.login({
			email: 'ALICE@EXAMPLE.COM',
			password: 'StrongPass1!',
		});
		expect(result.user.email).toBe('alice@example.com');
	});

	test('returns correct user info without password_hash', async () => {
		const result = await service.login({
			email: 'alice@example.com',
			password: 'StrongPass1!',
		});
		expect(result.user.name).toBe('Alice');
		expect(result.user.role).toBe('user');
		expect(result.user).not.toHaveProperty('password_hash');
	});

	test('access token payload contains user info', async () => {
		const result = await service.login({
			email: 'alice@example.com',
			password: 'StrongPass1!',
		});
		const payload = await verifyAccessToken(result.tokens.accessToken, TEST_SECRET);
		expect(payload.email).toBe('alice@example.com');
		expect(payload.role).toBe('user');
	});

	test('creates a new session record on each login', async () => {
		// signup creates 1 session, login creates another
		await service.login({ email: 'alice@example.com', password: 'StrongPass1!' });
		expect(db.sessions.size).toBe(2);
	});

	test('throws AuthError with 401 for non-existent email', async () => {
		try {
			await service.login({ email: 'nobody@example.com', password: 'StrongPass1!' });
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(AuthError);
			if (e instanceof AuthError) {
				expect(e.code).toBe('INVALID_CREDENTIALS');
				expect(e.statusCode).toBe(401);
			}
		}
	});

	test('throws AuthError with 401 for wrong password', async () => {
		try {
			await service.login({ email: 'alice@example.com', password: 'WrongPass1!' });
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(AuthError);
			if (e instanceof AuthError) {
				expect(e.code).toBe('INVALID_CREDENTIALS');
				expect(e.statusCode).toBe(401);
			}
		}
	});

	test('non-existent and wrong-password errors have same message (prevents enumeration)', async () => {
		let msg1 = '';
		let msg2 = '';
		try {
			await service.login({ email: 'nobody@example.com', password: 'any' });
		} catch (e) {
			if (e instanceof AuthError) msg1 = e.message;
		}
		try {
			await service.login({ email: 'alice@example.com', password: 'wrongpass' });
		} catch (e) {
			if (e instanceof AuthError) msg2 = e.message;
		}
		expect(msg1).toBe(msg2);
	});

	test('throws AuthError with 401 for deactivated account', async () => {
		const user = db.findUserByEmail('alice@example.com');
		user!.is_active = false;

		try {
			await service.login({ email: 'alice@example.com', password: 'StrongPass1!' });
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(AuthError);
			if (e instanceof AuthError) {
				expect(e.code).toBe('ACCOUNT_INACTIVE');
				expect(e.statusCode).toBe(401);
			}
		}
	});
});

describe('AuthService.refreshTokens', () => {
	let db: InMemoryDb;
	let service: AuthService;
	let initialTokens: { accessToken: string; refreshToken: string; expiresIn: number };

	beforeEach(async () => {
		db = new InMemoryDb();
		service = createService(db);
		const result = await service.signup({
			email: 'alice@example.com',
			password: 'StrongPass1!',
			name: 'Alice',
		});
		initialTokens = result.tokens;
	});

	test('returns new valid access and refresh tokens', async () => {
		const newTokens = await service.refreshTokens(initialTokens.refreshToken);

		expect(newTokens.accessToken).toBeTruthy();
		expect(newTokens.refreshToken).toBeTruthy();

		// Verify new access token is valid
		const payload = await verifyAccessToken(newTokens.accessToken, TEST_SECRET);
		expect(payload.email).toBe('alice@example.com');
	});

	test('new refresh token is different from old refresh token', async () => {
		const newTokens = await service.refreshTokens(initialTokens.refreshToken);

		// Refresh tokens are random opaque hex strings - always unique
		expect(newTokens.refreshToken).not.toBe(initialTokens.refreshToken);
		// New access token is valid and correctly structured
		const payload = await verifyAccessToken(newTokens.accessToken, TEST_SECRET);
		expect(payload.type).toBe('access');
		expect(payload.sub).toBeTruthy();
	});

	test('revokes old session after refresh (token rotation)', async () => {
		await service.refreshTokens(initialTokens.refreshToken);

		const oldHash = hashToken(initialTokens.refreshToken);
		const oldSession = db.findSessionByRefreshTokenHash(oldHash);
		expect(oldSession!.revoked_at).not.toBeNull();
	});

	test('creates a new session record', async () => {
		const initialSessionCount = db.sessions.size;
		await service.refreshTokens(initialTokens.refreshToken);
		expect(db.sessions.size).toBe(initialSessionCount + 1);
	});

	test('throws AuthError for invalid refresh token string', async () => {
		try {
			await service.refreshTokens('not-a-valid-token');
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(AuthError);
			if (e instanceof AuthError) {
				expect(e.code).toBe('INVALID_REFRESH_TOKEN');
				expect(e.statusCode).toBe(401);
			}
		}
	});

	test('throws AuthError when using already-rotated refresh token (replay attack)', async () => {
		await service.refreshTokens(initialTokens.refreshToken);

		// Try to use the old refresh token again
		try {
			await service.refreshTokens(initialTokens.refreshToken);
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(AuthError);
			if (e instanceof AuthError) {
				expect(e.code).toBe('SESSION_REVOKED');
			}
		}
	});

	test('throws AuthError when session is manually revoked', async () => {
		await service.revokeSession(initialTokens.refreshToken);

		try {
			await service.refreshTokens(initialTokens.refreshToken);
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(AuthError);
			if (e instanceof AuthError) {
				expect(e.code).toBe('SESSION_REVOKED');
			}
		}
	});

	test('throws AuthError when session is expired', async () => {
		// Manually expire the session
		const hash = hashToken(initialTokens.refreshToken);
		const session = db.findSessionByRefreshTokenHash(hash);
		session!.expires_at = new Date(Date.now() - 1000);

		try {
			await service.refreshTokens(initialTokens.refreshToken);
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(AuthError);
			if (e instanceof AuthError) {
				expect(e.code).toBe('SESSION_EXPIRED');
			}
		}
	});

	test('throws AuthError when user is deactivated', async () => {
		const user = db.findUserByEmail('alice@example.com');
		user!.is_active = false;

		try {
			await service.refreshTokens(initialTokens.refreshToken);
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(AuthError);
			if (e instanceof AuthError) {
				expect(e.code).toBe('USER_NOT_FOUND');
			}
		}
	});
});

describe('AuthService.revokeSession', () => {
	let db: InMemoryDb;
	let service: AuthService;
	let refreshToken: string;

	beforeEach(async () => {
		db = new InMemoryDb();
		service = createService(db);
		const result = await service.signup({
			email: 'alice@example.com',
			password: 'StrongPass1!',
			name: 'Alice',
		});
		refreshToken = result.tokens.refreshToken;
	});

	test('sets revoked_at on the session', async () => {
		await service.revokeSession(refreshToken);

		const hash = hashToken(refreshToken);
		const session = db.findSessionByRefreshTokenHash(hash);
		expect(session!.revoked_at).not.toBeNull();
		expect(session!.revoked_at).toBeInstanceOf(Date);
	});

	test('throws AuthError when session not found', async () => {
		try {
			await service.revokeSession('nonexistent-token');
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(AuthError);
			if (e instanceof AuthError) {
				expect(e.code).toBe('SESSION_NOT_FOUND');
				expect(e.statusCode).toBe(404);
			}
		}
	});
});

describe('AuthService.revokeAllUserSessions', () => {
	let db: InMemoryDb;
	let service: AuthService;

	beforeEach(async () => {
		db = new InMemoryDb();
		service = createService(db);
	});

	test('revokes all active sessions for a user', async () => {
		const result = await service.signup({
			email: 'alice@example.com',
			password: 'StrongPass1!',
			name: 'Alice',
		});
		// Create more sessions via login
		await service.login({ email: 'alice@example.com', password: 'StrongPass1!' });
		await service.login({ email: 'alice@example.com', password: 'StrongPass1!' });

		const count = await service.revokeAllUserSessions(result.user.id);
		expect(count).toBe(3);

		// All sessions should be revoked
		for (const session of db.sessions.values()) {
			if (session.user_id === result.user.id) {
				expect(session.revoked_at).not.toBeNull();
			}
		}
	});

	test('does not revoke sessions from other users', async () => {
		const alice = await service.signup({
			email: 'alice@example.com',
			password: 'StrongPass1!',
			name: 'Alice',
		});
		const bob = await service.signup({
			email: 'bob@example.com',
			password: 'StrongPass1!',
			name: 'Bob',
		});

		await service.revokeAllUserSessions(alice.user.id);

		// Bob's session should still be active
		for (const session of db.sessions.values()) {
			if (session.user_id === bob.user.id) {
				expect(session.revoked_at).toBeNull();
			}
		}
	});

	test('returns 0 when user has no active sessions', async () => {
		const count = await service.revokeAllUserSessions('nonexistent-user-id');
		expect(count).toBe(0);
	});

	test('only counts non-revoked sessions in return value', async () => {
		const result = await service.signup({
			email: 'alice@example.com',
			password: 'StrongPass1!',
			name: 'Alice',
		});
		// Revoke all sessions
		await service.revokeAllUserSessions(result.user.id);
		// Revoke again — should return 0 (already revoked)
		const count = await service.revokeAllUserSessions(result.user.id);
		expect(count).toBe(0);
	});
});
