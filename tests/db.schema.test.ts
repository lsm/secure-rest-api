import { describe, test, expect } from 'bun:test';
import { InMemoryDb } from '../src/db/schema.ts';

describe('InMemoryDb', () => {
	test('starts empty', () => {
		const db = new InMemoryDb();
		expect(db.users.size).toBe(0);
		expect(db.sessions.size).toBe(0);
		expect(db.auditLogs).toHaveLength(0);
		expect(db.apiKeys.size).toBe(0);
	});

	test('reset() clears all data', () => {
		const db = new InMemoryDb();
		db.users.set('u1', {
			id: 'u1',
			email: 'a@b.com',
			password_hash: 'hash',
			name: 'Alice',
			role: 'user',
			is_active: true,
			created_at: new Date(),
			updated_at: new Date(),
		});
		db.auditLogs.push({ id: 'log-1', user_id: 'u1', action: 'login', resource: null, ip_address: null, user_agent: null, metadata: null, created_at: new Date() });

		db.reset();

		expect(db.users.size).toBe(0);
		expect(db.sessions.size).toBe(0);
		expect(db.auditLogs).toHaveLength(0);
		expect(db.apiKeys.size).toBe(0);
	});

	test('findUserByEmail returns undefined when not found', () => {
		const db = new InMemoryDb();
		expect(db.findUserByEmail('nobody@example.com')).toBeUndefined();
	});

	test('findUserById returns undefined when not found', () => {
		const db = new InMemoryDb();
		expect(db.findUserById('nonexistent-id')).toBeUndefined();
	});

	test('findSessionByRefreshTokenHash returns undefined when not found', () => {
		const db = new InMemoryDb();
		expect(db.findSessionByRefreshTokenHash('nonexistent-hash')).toBeUndefined();
	});
});
