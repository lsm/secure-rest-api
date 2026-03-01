// Sliding-window rate limiter backed by an in-memory store.
// Each entry tracks a list of request timestamps within the current window.

export interface RateLimitEntry {
	timestamps: number[];
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetAt: number; // Unix ms timestamp when the oldest request leaves the window
	total: number;
}

export interface RateLimiterConfig {
	/** Duration of the sliding window in milliseconds. */
	windowMs: number;
	/** Maximum number of requests allowed per window. */
	max: number;
}

export class RateLimiter {
	private store: Map<string, RateLimitEntry> = new Map();
	private readonly windowMs: number;
	private readonly max: number;
	private cleanupTimer: ReturnType<typeof setInterval> | null = null;

	constructor(config: RateLimiterConfig) {
		if (config.windowMs <= 0) throw new Error('windowMs must be positive');
		if (config.max <= 0) throw new Error('max must be positive');
		this.windowMs = config.windowMs;
		this.max = config.max;
	}

	/**
	 * Check and record a request for the given key.
	 * Returns whether the request is allowed and related metadata.
	 */
	check(key: string): RateLimitResult {
		const now = Date.now();
		const windowStart = now - this.windowMs;

		let entry = this.store.get(key);
		if (!entry) {
			entry = { timestamps: [] };
			this.store.set(key, entry);
		}

		// Evict timestamps outside the current window
		entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

		const count = entry.timestamps.length;

		if (count >= this.max) {
			// Oldest request timestamp determines when the window shifts enough to allow one more
			const oldest = entry.timestamps[0];
			const resetAt = oldest + this.windowMs;
			return {
				allowed: false,
				remaining: 0,
				resetAt,
				total: this.max,
			};
		}

		// Record this request
		entry.timestamps.push(now);

		const resetAt = entry.timestamps[0] + this.windowMs;
		return {
			allowed: true,
			remaining: this.max - entry.timestamps.length,
			resetAt,
			total: this.max,
		};
	}

	/** Reset the counter for a specific key (useful for testing or administrative overrides). */
	reset(key: string): void {
		this.store.delete(key);
	}

	/** Remove all entries whose timestamps have fully expired. */
	cleanup(): void {
		const windowStart = Date.now() - this.windowMs;
		for (const [key, entry] of this.store.entries()) {
			const valid = entry.timestamps.filter((t) => t > windowStart);
			if (valid.length === 0) {
				this.store.delete(key);
			} else {
				entry.timestamps = valid;
			}
		}
	}

	/** Start a periodic cleanup interval so the store doesn't grow unbounded. */
	startCleanup(intervalMs = 60_000): void {
		if (this.cleanupTimer !== null) return;
		this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
		// Don't prevent process exit
		if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
			(this.cleanupTimer as { unref(): void }).unref();
		}
	}

	stopCleanup(): void {
		if (this.cleanupTimer !== null) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}
	}

	get size(): number {
		return this.store.size;
	}
}
