import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { fetchStockData, StockApiError } from '../src/stock.ts';

// ---------------------------------------------------------------------------
// computeRSI (tested indirectly via fetchStockData with mocked fetch)
// ---------------------------------------------------------------------------

function makeTimeSeries(closes: number[]): Record<string, Record<string, string>> {
	const series: Record<string, Record<string, string>> = {};
	closes.forEach((c, i) => {
		// dates oldest→newest: 2020-01-01, 2020-01-02, …
		const d = new Date(2020, 0, i + 1);
		const key = d.toISOString().slice(0, 10);
		series[key] = { '4. close': String(c) };
	});
	return series;
}

function mockFetchWith(timeSeries: Record<string, Record<string, string>>) {
	global.fetch = mock(async () =>
		new Response(JSON.stringify({ 'Time Series (Daily)': timeSeries }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}),
	);
}

describe('fetchStockData – RSI correctness', () => {
	beforeEach(() => {
		// Reset mock before each test
		global.fetch = fetch;
	});

	test('normal prices produce RSI values between 0 and 100', async () => {
		// 20 linearly increasing closes
		const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
		mockFetchWith(makeTimeSeries(closes));

		const data = await fetchStockData('AAPL', 'demo');
		expect(data.rsi.length).toBeGreaterThan(0);
		for (const r of data.rsi) {
			expect(r).toBeGreaterThanOrEqual(0);
			expect(r).toBeLessThanOrEqual(100);
		}
	});

	test('all-gains window produces RSI of 100', async () => {
		// 20 strictly increasing closes → all gains, no losses
		const closes = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
		mockFetchWith(makeTimeSeries(closes));

		const data = await fetchStockData('AAPL', 'demo');
		expect(data.rsi[0]).toBe(100);
	});

	test('flat prices produce RSI of 50 (neutral)', async () => {
		// 20 identical closes → avgGain = 0, avgLoss = 0 → RSI = 50
		const closes = new Array(20).fill(150);
		mockFetchWith(makeTimeSeries(closes));

		const data = await fetchStockData('AAPL', 'demo');
		expect(data.rsi[0]).toBe(50);
	});

	test('insufficient data (≤14 points) returns empty arrays', async () => {
		const closes = new Array(14).fill(100);
		mockFetchWith(makeTimeSeries(closes));

		const data = await fetchStockData('AAPL', 'demo');
		expect(data.rsi).toHaveLength(0);
		expect(data.closes).toHaveLength(0);
		expect(data.dates).toHaveLength(0);
	});

	test('symbol is uppercased in response', async () => {
		mockFetchWith(makeTimeSeries(new Array(20).fill(100)));
		const data = await fetchStockData('aapl', 'demo');
		expect(data.symbol).toBe('AAPL');
	});

	test('dates, closes, and rsi arrays have equal length', async () => {
		const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5);
		mockFetchWith(makeTimeSeries(closes));

		const data = await fetchStockData('MSFT', 'demo');
		expect(data.dates.length).toBe(data.closes.length);
		expect(data.dates.length).toBe(data.rsi.length);
	});
});

describe('fetchStockData – error handling', () => {
	test('throws StockApiError on rate-limit Note', async () => {
		global.fetch = mock(async () =>
			new Response(JSON.stringify({ Note: 'API call frequency limit reached.' }), { status: 200 }),
		);
		await expect(fetchStockData('AAPL', 'demo')).rejects.toBeInstanceOf(StockApiError);
	});

	test('throws StockApiError on Error Message (bad symbol)', async () => {
		global.fetch = mock(async () =>
			new Response(JSON.stringify({ 'Error Message': 'Invalid API call.' }), { status: 200 }),
		);
		try {
			await fetchStockData('INVALID', 'demo');
			expect(true).toBe(false);
		} catch (e) {
			expect(e).toBeInstanceOf(StockApiError);
			if (e instanceof StockApiError) expect(e.statusCode).toBe(404);
		}
	});

	test('throws StockApiError on Information (demo key)', async () => {
		global.fetch = mock(async () =>
			new Response(
				JSON.stringify({ Information: 'The **demo** API key is for demo purposes only.' }),
				{ status: 200 },
			),
		);
		await expect(fetchStockData('TSLA', 'demo')).rejects.toBeInstanceOf(StockApiError);
	});

	test('throws StockApiError on missing Time Series field', async () => {
		global.fetch = mock(async () =>
			new Response(JSON.stringify({ 'Meta Data': {} }), { status: 200 }),
		);
		await expect(fetchStockData('AAPL', 'demo')).rejects.toBeInstanceOf(StockApiError);
	});

	test('throws StockApiError on HTTP error status', async () => {
		global.fetch = mock(async () => new Response('', { status: 503 }));
		await expect(fetchStockData('AAPL', 'demo')).rejects.toBeInstanceOf(StockApiError);
	});
});
