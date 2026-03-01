// Database schema types for the REST API
// Tables: users, sessions, audit_logs, api_keys

export interface User {
	id: string;
	email: string;
	password_hash: string;
	name: string;
	role: 'user' | 'admin';
	is_active: boolean;
	created_at: Date;
	updated_at: Date;
}

export interface Session {
	id: string;
	user_id: string;
	refresh_token_hash: string;
	expires_at: Date;
	user_agent: string | null;
	ip_address: string | null;
	created_at: Date;
	revoked_at: Date | null;
}

export interface AuditLog {
	id: string;
	user_id: string | null;
	action: string;
	resource: string | null;
	ip_address: string | null;
	user_agent: string | null;
	metadata: Record<string, unknown> | null;
	created_at: Date;
}

export interface ApiKey {
	id: string;
	user_id: string;
	name: string;
	key_hash: string;
	key_prefix: string;
	scopes: string[];
	expires_at: Date | null;
	last_used_at: Date | null;
	created_at: Date;
	revoked_at: Date | null;
}

// In-memory database simulation for testing
export class InMemoryDb {
	users: Map<string, User> = new Map();
	sessions: Map<string, Session> = new Map();
	auditLogs: AuditLog[] = [];
	apiKeys: Map<string, ApiKey> = new Map();

	reset() {
		this.users.clear();
		this.sessions.clear();
		this.auditLogs = [];
		this.apiKeys.clear();
	}

	findUserByEmail(email: string): User | undefined {
		for (const user of this.users.values()) {
			if (user.email === email) return user;
		}
		return undefined;
	}

	findUserById(id: string): User | undefined {
		return this.users.get(id);
	}

	findSessionByRefreshTokenHash(hash: string): Session | undefined {
		for (const session of this.sessions.values()) {
			if (session.refresh_token_hash === hash) return session;
		}
		return undefined;
	}
}
