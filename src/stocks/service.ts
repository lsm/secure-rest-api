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

export interface StockServiceConfig {
	apiKey?: string;
	fetch?: typeof globalThis.fetch;
}

export class StockError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly statusCode: number = 400,
	) {
		super(message);
		this.name = 'StockError';
	}
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const BASE_URL = 'https://www.alphavantage.co/query';

export class StockService {
	private readonly apiKey: string;
	private readonly fetcher: typeof globalThis.fetch;
	private readonly cache = new Map<string, CacheEntry>();

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
	}

	async getDailyCandles(symbol: string, dateRange?: DateRange): Promise<OHLCVCandle[]> {
		const upperSymbol = symbol.toUpperCase();

		// Serve from cache if still fresh
		const cached = this.cache.get(upperSymbol);
		if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
			return this.filterByDateRange(cached.candles, dateRange);
		}

		// Fetch full history from Alpha Vantage
		const url = new URL(BASE_URL);
		url.searchParams.set('function', 'TIME_SERIES_DAILY');
		url.searchParams.set('symbol', upperSymbol);
		url.searchParams.set('outputsize', 'full');
		url.searchParams.set('apikey', this.apiKey);

		const response = await this.fetcher(url.toString());

		if (!response.ok) {
			throw new StockError(
				`Alpha Vantage API request failed with HTTP ${response.status}.`,
				'API_ERROR',
				response.status,
			);
		}

		const data = (await response.json()) as AlphaVantageDailyResponse;

		// Rate-limit note returned in body (API responds 200 even when throttled)
		if (data['Note']) {
			throw new StockError(
				'Alpha Vantage rate limit reached. Wait before retrying (free tier: 5 req/min, 500 req/day).',
				'RATE_LIMITED',
				429,
			);
		}

		// Invalid API key or other hard errors
		if (data['Information']) {
			throw new StockError(
				`Alpha Vantage API error: ${data['Information']}`,
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

		return this.filterByDateRange(candles, dateRange);
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
}
