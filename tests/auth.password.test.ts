import { describe, test, expect } from 'bun:test';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../src/auth/password.ts';

describe('hashPassword', () => {
	test('hashes a password into a non-empty string', async () => {
		const hash = await hashPassword('MyPassword1!');
		expect(typeof hash).toBe('string');
		expect(hash.length).toBeGreaterThan(0);
	});

	test('produces different hashes for the same password (unique salts)', async () => {
		const hash1 = await hashPassword('MyPassword1!');
		const hash2 = await hashPassword('MyPassword1!');
		expect(hash1).not.toBe(hash2);
	});

	test('does not return the original password', async () => {
		const password = 'MyPassword1!';
		const hash = await hashPassword(password);
		expect(hash).not.toBe(password);
		expect(hash).not.toContain(password);
	});
});

describe('verifyPassword', () => {
	test('returns true for correct password', async () => {
		const password = 'MyPassword1!';
		const hash = await hashPassword(password);
		const result = await verifyPassword(password, hash);
		expect(result).toBe(true);
	});

	test('returns false for incorrect password', async () => {
		const hash = await hashPassword('MyPassword1!');
		const result = await verifyPassword('WrongPassword1!', hash);
		expect(result).toBe(false);
	});

	test('returns false for empty password against valid hash', async () => {
		const hash = await hashPassword('MyPassword1!');
		const result = await verifyPassword('', hash);
		expect(result).toBe(false);
	});

	test('returns false for partial match', async () => {
		const hash = await hashPassword('MyPassword1!');
		const result = await verifyPassword('MyPassword', hash);
		expect(result).toBe(false);
	});

	test('is case-sensitive', async () => {
		const hash = await hashPassword('MyPassword1!');
		const result = await verifyPassword('mypassword1!', hash);
		expect(result).toBe(false);
	});
});

describe('validatePasswordStrength', () => {
	test('accepts a strong password', () => {
		const { valid, errors } = validatePasswordStrength('StrongPass1!');
		expect(valid).toBe(true);
		expect(errors).toHaveLength(0);
	});

	test('rejects password shorter than 8 characters', () => {
		const { valid, errors } = validatePasswordStrength('Ab1!');
		expect(valid).toBe(false);
		expect(errors).toContain('Password must be at least 8 characters long');
	});

	test('rejects password without uppercase letter', () => {
		const { valid, errors } = validatePasswordStrength('password1!');
		expect(valid).toBe(false);
		expect(errors).toContain('Password must contain at least one uppercase letter');
	});

	test('rejects password without lowercase letter', () => {
		const { valid, errors } = validatePasswordStrength('PASSWORD1!');
		expect(valid).toBe(false);
		expect(errors).toContain('Password must contain at least one lowercase letter');
	});

	test('rejects password without number', () => {
		const { valid, errors } = validatePasswordStrength('Password!');
		expect(valid).toBe(false);
		expect(errors).toContain('Password must contain at least one number');
	});

	test('rejects password without special character', () => {
		const { valid, errors } = validatePasswordStrength('Password123');
		expect(valid).toBe(false);
		expect(errors).toContain('Password must contain at least one special character');
	});

	test('returns multiple errors for very weak password', () => {
		const { valid, errors } = validatePasswordStrength('weak');
		expect(valid).toBe(false);
		expect(errors.length).toBeGreaterThan(1);
	});
});
