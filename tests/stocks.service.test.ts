import { describe, test, expect, afterEach } from 'bun:test';
import { StockService, StockError } from '../src/stocks/service.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDailyResponse(symbol: string, dates: string[]) {
	const timeSeries: Record<string, Record<string, string>> = {};
	dates.forEach((date, i) => {
		timeSeries[date] = {
			'1. open': `${100 + i}.0000`,
			'2. high': `${105 + i}.0000`,
			'3. low': `${95 + i}.0000`,
			'4. close': `${102 + i}.0000`,
			'5. volume': `${1_000_000 + i * 100_000}`,
		};
	});
	return {
		'Meta Data': {
			'1. Information': 'Daily Prices',
			'2. Symbol': symbol,
			'3. Last Refreshed': dates.at(-1) ?? '',
			'4. Output Size': 'Full size',
			'5. Time Zone': 'US/Eastern',
		},
		'Time Series (Daily)': timeSeries,
	};
}

function mockFetch(body: unknown, status = 200): typeof globalThis.fetch {
	return async () =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});
}

const TEST_DATES = ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];

// ---------------------------------------------------------------------------
// Constructor – API key handling
// ---------------------------------------------------------------------------

describe('StockService constructor', () => {
	const savedKey = process.env['ALPHAVANTAGE_API_KEY'];

	afterEach(() => {
		if (savedKey === undefined) {
			delete process.env['ALPHAVANTAGE_API_KEY'];
		} else {
			process.env['ALPHAVANTAGE_API_KEY'] = savedKey;
		}
	});

	test('throws StockError MISSING_API_KEY when no key is available', () => {
		delete process.env['ALPHAVANTAGE_API_KEY'];
		try {
			new StockService();
			expect(true).toBe(false); // unreachable
		} catch (e) {
			expect(e).toBeInstanceOf(StockError);
			if (e instanceof StockError) {
				expect(e.code).toBe('MISSING_API_KEY');
				expect(e.statusCode).toBe(500);
			}
		}
	});

	test('constructs successfully when apiKey is passed in config', () => {
		delete process.env['ALPHAVANTAGE_API_KEY'];
		expect(() => new StockService({ apiKey: 'test-key' })).not.toThrow();
	});

	test('constructs successfully when key is in ALPHAVANTAGE_API_KEY env var', () => {
		process.env['ALPHAVANTAGE_API_KEY'] = 'env-key';
		expect(() => new StockService()).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// getDailyCandles – happy path
// ---------------------------------------------------------------------------

describe('StockService.getDailyCandles – happy path', () => {
	test('returns candles sorted by date ascending', async () => {
		// Alpha Vantage returns dates newest-first; service must sort ascending
		const reversedDates = [...TEST_DATES].reverse();
		const service = new StockService({
			apiKey: 'key',
			fetch: mockFetch(buildDailyResponse('AAPL', reversedDates)),
		});

		const candles = await service.getDailyCandles('AAPL');
		expect(candles.length).toBe(4);
		for (let i = 1; i < candles.length; i++) {
			expect(candles[i]!.date >= candles[i - 1]!.date).toBe(true);
		}
	});

	test('returns correctly typed OHLCV numbers', async () => {
		const service = new StockService({
			apiKey: 'key',
			fetch: mockFetch(buildDailyResponse('AAPL', ['2024-01-02'])),
		});

		const [candle] = await service.getDailyCandles('AAPL');
		expect(candle).toBeDefined();
		expect(candle!.date).toBe('2024-01-02');
		expect(typeof candle!.open).toBe('number');
		expect(typeof candle!.high).toBe('number');
		expect(typeof candle!.low).toBe('number');
		expect(typeof candle!.close).toBe('number');
		expect(typeof candle!.volume).toBe('number');
		expect(candle!.open).toBe(100);
		expect(candle!.high).toBe(105);
		expect(candle!.low).toBe(95);
		expect(candle!.close).toBe(102);
		expect(candle!.volume).toBe(1_000_000);
	});

	test('normalises symbol to uppercase in the request URL', async () => {
		let capturedUrl = '';
		const captureFetch: typeof globalThis.fetch = async (input) => {
			capturedUrl = input.toString();
			return new Response(JSON.stringify(buildDailyResponse('AAPL', ['2024-01-02'])), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		};

		await new StockService({ apiKey: 'key', fetch: captureFetch }).getDailyCandles('aapl');
		expect(capturedUrl).toContain('symbol=AAPL');
	});

	test('filters candles by startDate (inclusive)', async () => {
		const service = new StockService({
			apiKey: 'key',
			fetch: mockFetch(buildDailyResponse('AAPL', TEST_DATES)),
		});

		const candles = await service.getDailyCandles('AAPL', { startDate: '2024-01-03' });
		expect(candles.length).toBe(3);
		expect(candles[0]!.date).toBe('2024-01-03');
	});

	test('filters candles by endDate (inclusive)', async () => {
		const service = new StockService({
			apiKey: 'key',
			fetch: mockFetch(buildDailyResponse('AAPL', TEST_DATES)),
		});

		const candles = await service.getDailyCandles('AAPL', { endDate: '2024-01-03' });
		expect(candles.length).toBe(2);
		expect(candles.at(-1)!.date).toBe('2024-01-03');
	});

	test('filters candles by both startDate and endDate', async () => {
		const service = new StockService({
			apiKey: 'key',
			fetch: mockFetch(buildDailyResponse('AAPL', TEST_DATES)),
		});

		const candles = await service.getDailyCandles('AAPL', {
			startDate: '2024-01-03',
			endDate: '2024-01-04',
		});
		expect(candles.length).toBe(2);
		expect(candles[0]!.date).toBe('2024-01-03');
		expect(candles[1]!.date).toBe('2024-01-04');
	});
});

// ---------------------------------------------------------------------------
// getDailyCandles – caching
// ---------------------------------------------------------------------------

describe('StockService.getDailyCandles – in-memory cache', () => {
	test('second call within TTL window does not trigger a new fetch', async () => {
		let callCount = 0;
		const countingFetch: typeof globalThis.fetch = async () => {
			callCount++;
			return new Response(JSON.stringify(buildDailyResponse('AAPL', TEST_DATES)), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		};

		const service = new StockService({ apiKey: 'key', fetch: countingFetch });
		await service.getDailyCandles('AAPL');
		await service.getDailyCandles('AAPL');
		await service.getDailyCandles('AAPL');

		expect(callCount).toBe(1);
	});

	test('cache is keyed per symbol – different symbols each trigger a fetch', async () => {
		let callCount = 0;
		const countingFetch: typeof globalThis.fetch = async (input) => {
			callCount++;
			const symbol = input.toString().includes('MSFT') ? 'MSFT' : 'AAPL';
			return new Response(JSON.stringify(buildDailyResponse(symbol, TEST_DATES)), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		};

		const service = new StockService({ apiKey: 'key', fetch: countingFetch });
		await service.getDailyCandles('AAPL');
		await service.getDailyCandles('MSFT');
		await service.getDailyCandles('AAPL'); // cache hit

		expect(callCount).toBe(2);
	});

	test('date range filtering applies to cached data without re-fetching', async () => {
		let callCount = 0;
		const service = new StockService({
			apiKey: 'key',
			fetch: async () => {
				callCount++;
				return new Response(JSON.stringify(buildDailyResponse('AAPL', TEST_DATES)), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			},
		});

		await service.getDailyCandles('AAPL');
		const filtered = await service.getDailyCandles('AAPL', { startDate: '2024-01-04' });

		expect(callCount).toBe(1);
		expect(filtered.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// getDailyCandles – API error handling
// ---------------------------------------------------------------------------

describe('StockService.getDailyCandles – API error handling', () => {
	test('throws StockError RATE_LIMITED when response body contains "Note" field', async () => {
		const service = new StockService({
			apiKey: 'key',
			fetch: mockFetch({
				Note: 'Thank you for using Alpha Vantage! Standard API rate limit is 5 req/min.',
			}),
		});

		try {
			await service.getDailyCandles('AAPL');
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(StockError);
			if (e instanceof StockError) {
				expect(e.code).toBe('RATE_LIMITED');
				expect(e.statusCode).toBe(429);
			}
		}
	});

	test('throws StockError API_ERROR when response body contains "Information" field', async () => {
		const service = new StockService({
			apiKey: 'key',
			fetch: mockFetch({ Information: 'Invalid API key. Please claim your free API key.' }),
		});

		try {
			await service.getDailyCandles('AAPL');
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(StockError);
			if (e instanceof StockError) {
				expect(e.code).toBe('API_ERROR');
				expect(e.statusCode).toBe(403);
			}
		}
	});

	test('throws StockError NO_DATA for an invalid ticker symbol', async () => {
		const service = new StockService({
			apiKey: 'key',
			fetch: mockFetch({
				'Meta Data': { '2. Symbol': 'INVALID' },
				// deliberately omits "Time Series (Daily)"
			}),
		});

		try {
			await service.getDailyCandles('INVALID');
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(StockError);
			if (e instanceof StockError) {
				expect(e.code).toBe('NO_DATA');
				expect(e.statusCode).toBe(404);
			}
		}
	});

	test('throws StockError API_ERROR when HTTP response is non-2xx', async () => {
		const service = new StockService({
			apiKey: 'key',
			fetch: mockFetch('Internal Server Error', 500),
		});

		try {
			await service.getDailyCandles('AAPL');
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(StockError);
			if (e instanceof StockError) {
				expect(e.code).toBe('API_ERROR');
				expect(e.statusCode).toBe(500);
			}
		}
	});
});
