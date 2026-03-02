import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { createApp } from '../src/app.ts';
import type { StockService } from '../src/stocks/service.ts';
import type { Candle } from '../src/stocks/types.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_CANDLES: Candle[] = Array.from({ length: 30 }, (_, i) => ({
	date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
	open: 150 + i,
	high: 155 + i,
	low: 148 + i,
	close: 152 + i,
	volume: 1_000_000 + i * 1000,
}));

// RSI array aligned with MOCK_CANDLES; first 14 are null, rest are values
const MOCK_RSI: (number | null)[] = [
	...Array(14).fill(null),
	...Array.from({ length: 16 }, (_, i) => 50 + i),
];

// ---------------------------------------------------------------------------
// Mock StockService
// ---------------------------------------------------------------------------

function makeMockService(overrides: Partial<StockService> = {}): StockService {
	return {
		getCandles: mock(async (_symbol: string) => MOCK_CANDLES),
		calculateRsi: mock((_candles: Candle[]) => MOCK_RSI),
		getRsiSignal: mock((_value: number) => 'neutral' as const),
		...overrides,
	} as unknown as StockService;
}

// ---------------------------------------------------------------------------
// GET /api/stocks/:symbol
// ---------------------------------------------------------------------------

describe('GET /api/stocks/:symbol', () => {
	let app: ReturnType<typeof createApp>;
	let mockService: StockService;

	beforeEach(() => {
		mockService = makeMockService();
		app = createApp(mockService);
	});

	test('returns 200 with candles and rsi arrays', async () => {
		const res = await app.request('/api/stocks/AAPL');
		expect(res.status).toBe(200);

		const body = await res.json() as Record<string, unknown>;
		expect(body.symbol).toBe('AAPL');
		expect(Array.isArray(body.candles)).toBe(true);
		expect(Array.isArray(body.rsi)).toBe(true);
		// Route strips null-warmup entries and slices to last 90; MOCK_RSI has 14
		// nulls then 16 values → 16 non-null entries (< 90 so all are returned)
		const expectedLen = MOCK_RSI.filter((v) => v !== null).length;
		expect((body.candles as Candle[]).length).toBe(expectedLen);
		expect((body.rsi as unknown[]).length).toBe(expectedLen);
	});

	test('uppercases the symbol', async () => {
		await app.request('/api/stocks/aapl');
		expect(mockService.getCandles).toHaveBeenCalledWith('AAPL', 104);
	});

	test('returns 400 for invalid symbol', async () => {
		const res = await app.request('/api/stocks/$INVALID!!');
		expect(res.status).toBe(400);
		const body = await res.json() as { error: string };
		expect(body.error).toBe('Invalid symbol');
	});

	test('returns 400 for symbol with spaces', async () => {
		const res = await app.request('/api/stocks/AA%20PL');
		expect(res.status).toBe(400);
		const body = await res.json() as { error: string };
		expect(body.error).toBe('Invalid symbol');
	});

	test('candles contain required OHLCV fields', async () => {
		const res = await app.request('/api/stocks/AAPL');
		const body = await res.json() as { candles: Candle[] };
		const candle = body.candles[0];

		expect(candle).toHaveProperty('date');
		expect(candle).toHaveProperty('open');
		expect(candle).toHaveProperty('high');
		expect(candle).toHaveProperty('low');
		expect(candle).toHaveProperty('close');
		expect(candle).toHaveProperty('volume');
	});

	test('returns rate limit headers', async () => {
		const res = await app.request('/api/stocks/AAPL');
		expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
		expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
		expect(res.headers.get('X-RateLimit-Reset')).not.toBeNull();
	});

	test('returns 502 when StockService throws', async () => {
		const failingService = makeMockService({
			getCandles: mock(async () => {
				throw new Error('API key invalid');
			}),
		});
		const failApp = createApp(failingService);

		const res = await failApp.request('/api/stocks/BADKEY');
		expect(res.status).toBe(502);

		// Upstream errors are not leaked to the client
		const body = await res.json() as { error: string };
		expect(body.error).toBe('Failed to fetch stock data');
	});

	test('returns 429 after exceeding rate limit', async () => {
		// Use a very low limit via override option
		const { createRateLimitMiddleware, RateLimiter } = await import('../src/rate-limit/index.ts');
		const { Hono } = await import('hono');
		const { createStocksRouter } = await import('../src/stocks/routes.ts');

		const limiter = new RateLimiter({ windowMs: 60_000, max: 2 });
		const tightApp = new Hono();
		tightApp.use('/api/*', createRateLimitMiddleware({ windowMs: 60_000, max: 2, limiter }));
		tightApp.route('/api/stocks', createStocksRouter(mockService));

		await tightApp.request('/api/stocks/AAPL');
		await tightApp.request('/api/stocks/AAPL');
		const res = await tightApp.request('/api/stocks/AAPL');

		expect(res.status).toBe(429);
		const body = await res.json() as { code: string };
		expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
		expect(res.headers.get('Retry-After')).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// GET /api/stocks/:symbol/rsi
// ---------------------------------------------------------------------------

describe('GET /api/stocks/:symbol/rsi', () => {
	let app: ReturnType<typeof createApp>;
	let mockService: StockService;

	beforeEach(() => {
		mockService = makeMockService();
		app = createApp(mockService);
	});

	test('returns 200 with rsi value, signal, and date', async () => {
		const res = await app.request('/api/stocks/AAPL/rsi');
		expect(res.status).toBe(200);

		const body = await res.json() as { symbol: string; date: string; rsi: number; signal: string };
		expect(body.symbol).toBe('AAPL');
		expect(typeof body.rsi).toBe('number');
		expect(['oversold', 'neutral', 'overbought']).toContain(body.signal);
		// date field must be present (corresponds to the candle date of latest RSI)
		expect(typeof body.date).toBe('string');
	});

	test('signal reflects getRsiSignal result', async () => {
		const service = makeMockService({
			getRsiSignal: mock((_v: number) => 'oversold' as const),
		});
		const testApp = createApp(service);

		const res = await testApp.request('/api/stocks/AAPL/rsi');
		const body = await res.json() as { signal: string };
		expect(body.signal).toBe('oversold');
	});

	test('returns latest non-null RSI value', async () => {
		// Last non-null RSI in MOCK_RSI is index 29 → 50 + (29-14) = 65
		const res = await app.request('/api/stocks/AAPL/rsi');
		const body = await res.json() as { rsi: number };
		expect(body.rsi).toBe(65);
	});

	test('returns rate limit headers', async () => {
		const res = await app.request('/api/stocks/AAPL/rsi');
		expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
		expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
	});

	test('returns 400 for invalid symbol', async () => {
		const res = await app.request('/api/stocks/$BAD!!/rsi');
		expect(res.status).toBe(400);
		const body = await res.json() as { error: string };
		expect(body.error).toBe('Invalid symbol');
	});

	test('returns 422 when all RSI values are null', async () => {
		const service = makeMockService({
			calculateRsi: mock((_candles: Candle[]) => [null, null, null] as (number | null)[]),
		});
		const testApp = createApp(service);

		const res = await testApp.request('/api/stocks/AAPL/rsi');
		expect(res.status).toBe(422);
	});

	test('returns 502 when StockService throws', async () => {
		const failingService = makeMockService({
			getCandles: mock(async () => {
				throw new Error('Network error');
			}),
		});
		const failApp = createApp(failingService);

		const res = await failApp.request('/api/stocks/AAPL/rsi');
		expect(res.status).toBe(502);
	});
});

// ---------------------------------------------------------------------------
// GET / (root)
// ---------------------------------------------------------------------------

describe('GET /', () => {
	test('returns 200 HTML', async () => {
		const app = createApp(makeMockService());
		const res = await app.request('/');
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toContain('text/html');
	});
});
