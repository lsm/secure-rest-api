import { randomUUID } from 'node:crypto';
import type { InMemoryDb, User } from '../db/schema.ts';
import { hashPassword, verifyPassword, validatePasswordStrength } from './password.ts';
import {
	signAccessToken,
	signRefreshToken,
	hashToken,
	generateRefreshToken,
	getRefreshTokenExpiryDate,
	ACCESS_TOKEN_EXPIRY_SECS,
	type TokenPair,
} from './tokens.ts';

export interface SignupInput {
	email: string;
	password: string;
	name: string;
}

export interface LoginInput {
	email: string;
	password: string;
}

export interface AuthResult {
	user: Omit<User, 'password_hash'>;
	tokens: TokenPair;
}

export interface AuthServiceConfig {
	jwtSecret: string;
	db: InMemoryDb;
}

export class AuthError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly statusCode: number = 400,
	) {
		super(message);
		this.name = 'AuthError';
	}
}

export class AuthService {
	private jwtSecret: string;
	private db: InMemoryDb;

	constructor(config: AuthServiceConfig) {
		this.jwtSecret = config.jwtSecret;
		this.db = config.db;
	}

	async signup(input: SignupInput): Promise<AuthResult> {
		const { email, password, name } = input;

		// Validate email format
		if (!this.isValidEmail(email)) {
			throw new AuthError('Invalid email format', 'INVALID_EMAIL');
		}

		// Validate password strength
		const passwordCheck = validatePasswordStrength(password);
		if (!passwordCheck.valid) {
			throw new AuthError(
				`Weak password: ${passwordCheck.errors.join(', ')}`,
				'WEAK_PASSWORD',
			);
		}

		// Check email uniqueness
		const existing = this.db.findUserByEmail(email.toLowerCase());
		if (existing) {
			throw new AuthError('Email already registered', 'EMAIL_IN_USE', 409);
		}

		// Create user
		const userId = randomUUID();
		const password_hash = await hashPassword(password);
		const now = new Date();

		const user: User = {
			id: userId,
			email: email.toLowerCase(),
			password_hash,
			name: name.trim(),
			role: 'user',
			is_active: true,
			created_at: now,
			updated_at: now,
		};

		this.db.users.set(userId, user);

		// Create session and tokens
		const tokens = await this.createSessionAndTokens(userId, user.email, user.role);

		const { password_hash: _, ...safeUser } = user;
		return { user: safeUser, tokens };
	}

	async login(input: LoginInput): Promise<AuthResult> {
		const { email, password } = input;

		const user = this.db.findUserByEmail(email.toLowerCase());
		if (!user) {
			// Use same error message to prevent user enumeration
			throw new AuthError('Invalid credentials', 'INVALID_CREDENTIALS', 401);
		}

		if (!user.is_active) {
			throw new AuthError('Account is deactivated', 'ACCOUNT_INACTIVE', 401);
		}

		const passwordValid = await verifyPassword(password, user.password_hash);
		if (!passwordValid) {
			throw new AuthError('Invalid credentials', 'INVALID_CREDENTIALS', 401);
		}

		const tokens = await this.createSessionAndTokens(user.id, user.email, user.role);

		const { password_hash: _, ...safeUser } = user;
		return { user: safeUser, tokens };
	}

	async refreshTokens(refreshToken: string): Promise<TokenPair> {
		if (!refreshToken || refreshToken.length < 10) {
			throw new AuthError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN', 401);
		}

		const tokenHash = hashToken(refreshToken);
		const session = this.db.findSessionByRefreshTokenHash(tokenHash);

		if (!session) {
			throw new AuthError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN', 401);
		}

		if (session.revoked_at !== null) {
			throw new AuthError('Session has been revoked', 'SESSION_REVOKED', 401);
		}

		if (session.expires_at < new Date()) {
			throw new AuthError('Session has expired', 'SESSION_EXPIRED', 401);
		}

		const user = this.db.findUserById(session.user_id);
		if (!user || !user.is_active) {
			throw new AuthError('User not found or inactive', 'USER_NOT_FOUND', 401);
		}

		// Rotate refresh token - revoke old session
		session.revoked_at = new Date();

		// Create new session and tokens
		return this.createSessionAndTokens(user.id, user.email, user.role);
	}

	async revokeSession(refreshToken: string): Promise<void> {
		const tokenHash = hashToken(refreshToken);
		const session = this.db.findSessionByRefreshTokenHash(tokenHash);

		if (!session) {
			throw new AuthError('Session not found', 'SESSION_NOT_FOUND', 404);
		}

		session.revoked_at = new Date();
	}

	async revokeAllUserSessions(userId: string): Promise<number> {
		let count = 0;
		const now = new Date();
		for (const session of this.db.sessions.values()) {
			if (session.user_id === userId && session.revoked_at === null) {
				session.revoked_at = now;
				count++;
			}
		}
		return count;
	}

	private async createSessionAndTokens(
		userId: string,
		email: string,
		role: string,
	): Promise<TokenPair> {
		const sessionId = randomUUID();
		const rawRefreshToken = generateRefreshToken();
		const refreshTokenHash = hashToken(rawRefreshToken);

		const session = {
			id: sessionId,
			user_id: userId,
			refresh_token_hash: refreshTokenHash,
			expires_at: getRefreshTokenExpiryDate(),
			user_agent: null,
			ip_address: null,
			created_at: new Date(),
			revoked_at: null,
		};

		this.db.sessions.set(sessionId, session);

		const [accessToken, refreshToken] = await Promise.all([
			signAccessToken({ sub: userId, email, role }, this.jwtSecret),
			signRefreshToken({ sub: userId, sessionId }, this.jwtSecret),
		]);

		return {
			accessToken,
			refreshToken: rawRefreshToken,
			expiresIn: ACCESS_TOKEN_EXPIRY_SECS,
		};
	}

	private isValidEmail(email: string): boolean {
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
	}
}
