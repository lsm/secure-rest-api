import type { OHLCVCandle, DateRange } from './types.ts';

// Alpha Vantage raw API shapes
interface AlphaVantageDailyPoint {
	'1. open': string;
	'2. high': string;
	'3. low': string;
	'4. close': string;
	'5. volume': string;
}

interface AlphaVantageDailyResponse {
	'Meta Data'?: Record<string, string>;
	'Time Series (Daily)'?: Record<string, AlphaVantageDailyPoint>;
	'Note'?: string;
	'Information'?: string;
}

interface CacheEntry {
	candles: OHLCVCandle[];
	fetchedAt: number;
}

// Literal union keeps callers' switch/case exhaustive at compile time
export type StockErrorCode = 'MISSING_API_KEY' | 'RATE_LIMITED' | 'API_ERROR' | 'NO_DATA';

export interface StockServiceConfig {
	apiKey?: string;
	fetch?: typeof globalThis.fetch;
	/** Override TTL in milliseconds (default 5 minutes). Useful in tests. */
	ttlMs?: number;
	/** Override cleanup interval in milliseconds (default 10 minutes). Pass 0 to disable. */
	cleanupIntervalMs?: number;
}

export class StockError extends Error {
	constructor(
		message: string,
		public readonly code: StockErrorCode,
		public readonly statusCode: number = 400,
	) {
		super(message);
		this.name = 'StockError';
	}
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;         // 5 minutes
const DEFAULT_CLEANUP_MS = 10 * 60 * 1000;     // 10 minutes
const BASE_URL = 'https://www.alphavantage.co/query';

export class StockService {
	private readonly apiKey: string;
	private readonly fetcher: typeof globalThis.fetch;
	private readonly ttlMs: number;
	private readonly cache = new Map<string, CacheEntry>();
	// Deduplicates concurrent requests for the same symbol within a single flight
	private readonly inFlight = new Map<string, Promise<OHLCVCandle[]>>();
	private cleanupTimer: ReturnType<typeof setInterval> | null = null;

	constructor(config?: StockServiceConfig) {
		const apiKey = config?.apiKey ?? process.env['ALPHAVANTAGE_API_KEY'];
		if (!apiKey) {
			throw new StockError(
				'Alpha Vantage API key is missing. Set the ALPHAVANTAGE_API_KEY environment variable.',
				'MISSING_API_KEY',
				500,
			);
		}
		this.apiKey = apiKey;
		this.fetcher = config?.fetch ?? globalThis.fetch;
		this.ttlMs = config?.ttlMs ?? DEFAULT_TTL_MS;

		const cleanupIntervalMs = config?.cleanupIntervalMs ?? DEFAULT_CLEANUP_MS;
		if (cleanupIntervalMs > 0) {
			this.cleanupTimer = setInterval(() => this.cleanupExpired(), cleanupIntervalMs);
			// Allow the process to exit even when the timer is active
			if (typeof (this.cleanupTimer as NodeJS.Timeout).unref === 'function') {
				(this.cleanupTimer as NodeJS.Timeout).unref();
			}
		}
	}

	async getDailyCandles(symbol: string, dateRange?: DateRange): Promise<OHLCVCandle[]> {
		const upperSymbol = symbol.toUpperCase();

		// Serve from cache if still fresh; return a shallow copy so callers
		// cannot mutate the cached array.
		const cached = this.cache.get(upperSymbol);
		if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
			return this.filterByDateRange([...cached.candles], dateRange);
		}

		// Deduplicate concurrent in-flight requests for the same symbol
		const existing = this.inFlight.get(upperSymbol);
		if (existing) {
			const candles = await existing;
			return this.filterByDateRange([...candles], dateRange);
		}

		const promise = this.fetchAndCache(upperSymbol);
		this.inFlight.set(upperSymbol, promise);

		try {
			const candles = await promise;
			return this.filterByDateRange([...candles], dateRange);
		} finally {
			this.inFlight.delete(upperSymbol);
		}
	}

	/** Fetch from Alpha Vantage, parse, sort, and populate the cache. */
	private async fetchAndCache(upperSymbol: string): Promise<OHLCVCandle[]> {
		const url = new URL(BASE_URL);
		url.searchParams.set('function', 'TIME_SERIES_DAILY');
		url.searchParams.set('symbol', upperSymbol);
		url.searchParams.set('outputsize', 'full');
		url.searchParams.set('apikey', this.apiKey);

		let response: Response;
		try {
			response = await this.fetcher(url.toString());
		} catch (err) {
			throw new StockError(
				`Network error fetching data for "${upperSymbol}": ${err instanceof Error ? err.message : String(err)}`,
				'API_ERROR',
				503,
			);
		}

		if (!response.ok) {
			throw new StockError(
				`Alpha Vantage API request failed with HTTP ${response.status}.`,
				'API_ERROR',
				response.status,
			);
		}

		let data: AlphaVantageDailyResponse;
		try {
			data = (await response.json()) as AlphaVantageDailyResponse;
		} catch {
			throw new StockError(
				`Failed to parse Alpha Vantage response for "${upperSymbol}". Body was not valid JSON.`,
				'API_ERROR',
				502,
			);
		}

		// Rate-limit note returned in body (API responds 200 even when throttled)
		if (data['Note']) {
			throw new StockError(
				'Alpha Vantage rate limit reached. Wait before retrying (free tier: 5 req/min, 500 req/day).',
				'RATE_LIMITED',
				429,
			);
		}

		// Information field: used for both daily quota exhaustion and invalid key.
		// Alpha Vantage always opens daily-quota messages with "Thank you for using Alpha Vantage".
		if (data['Information']) {
			const info = data['Information'];
			if (info.includes('Thank you for using Alpha Vantage')) {
				throw new StockError(
					'Alpha Vantage daily rate limit reached. Wait until UTC midnight to retry.',
					'RATE_LIMITED',
					429,
				);
			}
			throw new StockError(
				`Alpha Vantage API error: ${info}`,
				'API_ERROR',
				403,
			);
		}

		const timeSeries = data['Time Series (Daily)'];
		if (!timeSeries) {
			throw new StockError(
				`No daily data returned for symbol "${upperSymbol}". Verify the ticker is valid.`,
				'NO_DATA',
				404,
			);
		}

		// Parse and sort candles oldest-first
		const candles: OHLCVCandle[] = Object.entries(timeSeries)
			.map(([date, point]) => ({
				date,
				open: parseFloat(point['1. open']),
				high: parseFloat(point['2. high']),
				low: parseFloat(point['3. low']),
				close: parseFloat(point['4. close']),
				volume: parseInt(point['5. volume'], 10),
			}))
			.sort((a, b) => a.date.localeCompare(b.date));

		this.cache.set(upperSymbol, { candles, fetchedAt: Date.now() });

		return candles;
	}

	private filterByDateRange(candles: OHLCVCandle[], dateRange?: DateRange): OHLCVCandle[] {
		if (!dateRange) return candles;
		const { startDate, endDate } = dateRange;
		return candles.filter((c) => {
			if (startDate && c.date < startDate) return false;
			if (endDate && c.date > endDate) return false;
			return true;
		});
	}

	/** Delete stale cache entries to prevent unbounded memory growth. */
	private cleanupExpired(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache) {
			if (now - entry.fetchedAt >= this.ttlMs) {
				this.cache.delete(key);
			}
		}
	}

	/** Stop the periodic cleanup timer (call during graceful shutdown or in tests). */
	stopCleanup(): void {
		if (this.cleanupTimer !== null) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}
	}
}
