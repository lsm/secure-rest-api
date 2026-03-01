import { z } from 'zod';

export const signupSchema = z.object({
	email: z.string().email('Invalid email format'),
	password: z.string().min(1, 'Password is required'),
	name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
});

export const loginSchema = z.object({
	email: z.string().email('Invalid email format'),
	password: z.string().min(1, 'Password is required'),
});

export const refreshTokenSchema = z.object({
	refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
