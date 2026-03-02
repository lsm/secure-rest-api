import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { createHash, randomBytes } from 'node:crypto';

export interface AccessTokenPayload extends JWTPayload {
	sub: string; // user ID
	email: string;
	role: string;
	type: 'access';
}

export interface RefreshTokenPayload extends JWTPayload {
	sub: string; // user ID
	sessionId: string;
	type: 'refresh';
}

export interface TokenPair {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
}

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60;

function getSecretKey(secret: string): Uint8Array {
	return new TextEncoder().encode(secret);
}

export async function signAccessToken(
	payload: Omit<AccessTokenPayload, 'type' | 'iat' | 'exp'>,
	secret: string,
): Promise<string> {
	const key = getSecretKey(secret);
	return new SignJWT({ ...payload, type: 'access' })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime(ACCESS_TOKEN_EXPIRY)
		.sign(key);
}

export async function signRefreshToken(
	payload: Omit<RefreshTokenPayload, 'type' | 'iat' | 'exp'>,
	secret: string,
): Promise<string> {
	const key = getSecretKey(secret);
	return new SignJWT({ ...payload, type: 'refresh' })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime(REFRESH_TOKEN_EXPIRY)
		.sign(key);
}

export async function verifyAccessToken(
	token: string,
	secret: string,
): Promise<AccessTokenPayload> {
	const key = getSecretKey(secret);
	const { payload } = await jwtVerify(token, key);
	if (payload.type !== 'access') {
		throw new Error('Invalid token type');
	}
	return payload as AccessTokenPayload;
}

export async function verifyRefreshToken(
	token: string,
	secret: string,
): Promise<RefreshTokenPayload> {
	const key = getSecretKey(secret);
	const { payload } = await jwtVerify(token, key);
	if (payload.type !== 'refresh') {
		throw new Error('Invalid token type');
	}
	return payload as RefreshTokenPayload;
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): string {
	return randomBytes(40).toString('hex');
}

export function getRefreshTokenExpiryDate(): Date {
	return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

export const ACCESS_TOKEN_EXPIRY_SECS = ACCESS_TOKEN_EXPIRY_SECONDS;
