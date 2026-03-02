import { describe, test, expect, beforeEach } from 'bun:test';
import {
	signAccessToken,
	signRefreshToken,
	verifyAccessToken,
	verifyRefreshToken,
	hashToken,
	generateRefreshToken,
	getRefreshTokenExpiryDate,
	ACCESS_TOKEN_EXPIRY_SECS,
} from '../src/auth/tokens.ts';

const TEST_SECRET = 'test-jwt-secret-that-is-long-enough-for-hs256';

describe('signAccessToken / verifyAccessToken', () => {
	test('signs and verifies a valid access token', async () => {
		const payload = { sub: 'user-123', email: 'test@example.com', role: 'user' };
		const token = await signAccessToken(payload, TEST_SECRET);

		expect(typeof token).toBe('string');
		expect(token.split('.')).toHaveLength(3); // JWT format

		const decoded = await verifyAccessToken(token, TEST_SECRET);
		expect(decoded.sub).toBe(payload.sub);
		expect(decoded.email).toBe(payload.email);
		expect(decoded.role).toBe(payload.role);
		expect(decoded.type).toBe('access');
	});

	test('includes iat and exp claims', async () => {
		const token = await signAccessToken(
			{ sub: 'u1', email: 'a@b.com', role: 'user' },
			TEST_SECRET,
		);
		const decoded = await verifyAccessToken(token, TEST_SECRET);
		expect(decoded.iat).toBeGreaterThan(0);
		expect(decoded.exp).toBeGreaterThan(0);
		expect((decoded.exp ?? 0) - (decoded.iat ?? 0)).toBe(ACCESS_TOKEN_EXPIRY_SECS);
	});

	test('fails verification with wrong secret', async () => {
		const token = await signAccessToken(
			{ sub: 'u1', email: 'a@b.com', role: 'user' },
			TEST_SECRET,
		);
		await expect(verifyAccessToken(token, 'wrong-secret')).rejects.toThrow();
	});

	test('fails to verify refresh token as access token', async () => {
		const token = await signRefreshToken(
			{ sub: 'u1', sessionId: 'sess-1' },
			TEST_SECRET,
		);
		await expect(verifyAccessToken(token, TEST_SECRET)).rejects.toThrow('Invalid token type');
	});

	test('fails verification of malformed token', async () => {
		await expect(verifyAccessToken('not.a.jwt', TEST_SECRET)).rejects.toThrow();
	});

	test('fails verification of empty string', async () => {
		await expect(verifyAccessToken('', TEST_SECRET)).rejects.toThrow();
	});
});

describe('signRefreshToken / verifyRefreshToken', () => {
	test('signs and verifies a valid refresh token', async () => {
		const payload = { sub: 'user-123', sessionId: 'session-456' };
		const token = await signRefreshToken(payload, TEST_SECRET);

		expect(typeof token).toBe('string');
		expect(token.split('.')).toHaveLength(3);

		const decoded = await verifyRefreshToken(token, TEST_SECRET);
		expect(decoded.sub).toBe(payload.sub);
		expect(decoded.sessionId).toBe(payload.sessionId);
		expect(decoded.type).toBe('refresh');
	});

	test('fails to verify access token as refresh token', async () => {
		const token = await signAccessToken(
			{ sub: 'u1', email: 'a@b.com', role: 'user' },
			TEST_SECRET,
		);
		await expect(verifyRefreshToken(token, TEST_SECRET)).rejects.toThrow('Invalid token type');
	});

	test('fails verification with wrong secret', async () => {
		const token = await signRefreshToken(
			{ sub: 'u1', sessionId: 'sess-1' },
			TEST_SECRET,
		);
		await expect(verifyRefreshToken(token, 'wrong-secret')).rejects.toThrow();
	});
});

describe('hashToken', () => {
	test('returns a 64-character hex string (SHA-256)', () => {
		const hash = hashToken('some-token-value');
		expect(hash).toHaveLength(64);
		expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
	});

	test('is deterministic', () => {
		const token = 'my-refresh-token';
		expect(hashToken(token)).toBe(hashToken(token));
	});

	test('produces different hashes for different tokens', () => {
		expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
	});
});

describe('generateRefreshToken', () => {
	test('returns a non-empty string', () => {
		const token = generateRefreshToken();
		expect(typeof token).toBe('string');
		expect(token.length).toBeGreaterThan(0);
	});

	test('returns a long hex string (80 chars from 40 bytes)', () => {
		const token = generateRefreshToken();
		expect(token).toHaveLength(80);
	});

	test('generates unique tokens each time', () => {
		const tokens = new Set(Array.from({ length: 20 }, () => generateRefreshToken()));
		expect(tokens.size).toBe(20);
	});
});

describe('getRefreshTokenExpiryDate', () => {
	test('returns a date 7 days in the future', () => {
		const now = new Date();
		const expiry = getRefreshTokenExpiryDate();
		const diffMs = expiry.getTime() - now.getTime();
		const diffDays = diffMs / (1000 * 60 * 60 * 24);
		// Should be approximately 7 days (allowing for DST offsets and setDate() precision)
		expect(diffDays).toBeGreaterThan(6.9);
		expect(diffDays).toBeLessThan(7.1);
	});

	test('returns a future date', () => {
		const expiry = getRefreshTokenExpiryDate();
		expect(expiry.getTime()).toBeGreaterThan(Date.now());
	});
});

describe('ACCESS_TOKEN_EXPIRY_SECS', () => {
	test('is 900 seconds (15 minutes)', () => {
		expect(ACCESS_TOKEN_EXPIRY_SECS).toBe(900);
	});
});
