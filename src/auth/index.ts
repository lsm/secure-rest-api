export { AuthService, AuthError } from './service.ts';
export type { SignupInput, LoginInput, AuthResult, AuthServiceConfig } from './service.ts';
export { hashPassword, verifyPassword, validatePasswordStrength } from './password.ts';
export {
	signAccessToken,
	signRefreshToken,
	verifyAccessToken,
	verifyRefreshToken,
	hashToken,
	generateRefreshToken,
	getRefreshTokenExpiryDate,
	ACCESS_TOKEN_EXPIRY_SECS,
} from './tokens.ts';
export type { AccessTokenPayload, RefreshTokenPayload, TokenPair } from './tokens.ts';
export {
	extractBearerToken,
	createAuthMiddleware,
	createRoleMiddleware,
	createOptionalAuthMiddleware,
} from './middleware.ts';
export { signupSchema, loginSchema, refreshTokenSchema } from './schemas.ts';
