import { describe, test, expect } from 'bun:test';
import { StockService } from '../src/stocks/service.ts';
import type { Candle } from '../src/stocks/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandles(closes: number[]): Candle[] {
	return closes.map((close, i) => ({
		date: `2024-01-${String(i + 1).padStart(2, '0')}`,
		open: close,
		high: close,
		low: close,
		close,
		volume: 1_000_000,
	}));
}

// ---------------------------------------------------------------------------
// StockService.calculateRsi — unit tests
// ---------------------------------------------------------------------------

describe('StockService.calculateRsi', () => {
	const service = new StockService('dummy-api-key');

	test('flat price series (all prices equal) returns RSI of 50', () => {
		// 20 candles all at price 100 — no gains, no losses
		const candles = makeCandles(Array(20).fill(100));
		const rsi = service.calculateRsi(candles);

		// All computed (non-null) values must be 50
		const computed = rsi.filter((v) => v !== null) as number[];
		expect(computed.length).toBeGreaterThan(0);
		for (const value of computed) {
			expect(value).toBe(50);
		}
	});

	test('fewer than 15 candles (period + 1) returns all nulls', () => {
		// Default period is 14, so we need at least 15 candles to compute any RSI.
		// With 14 candles the length check (closes.length < period + 1) triggers.
		const candles = makeCandles([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113]);
		expect(candles.length).toBe(14); // confirm fixture

		const rsi = service.calculateRsi(candles);

		// Every entry should be null — insufficient data
		expect(rsi.length).toBe(14);
		for (const value of rsi) {
			expect(value).toBeNull();
		}
	});

	test('normal increasing price series produces RSI values in [0, 100]', () => {
		// 30 candles with steadily rising closes — should produce an overbought RSI
		const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
		const candles = makeCandles(closes);
		const rsi = service.calculateRsi(candles);

		const computed = rsi.filter((v) => v !== null) as number[];
		expect(computed.length).toBeGreaterThan(0);
		for (const value of computed) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(100);
		}
	});

	test('normal decreasing price series produces RSI values in [0, 100]', () => {
		// 30 candles with steadily falling closes — should produce an oversold RSI
		const closes = Array.from({ length: 30 }, (_, i) => 200 - i);
		const candles = makeCandles(closes);
		const rsi = service.calculateRsi(candles);

		const computed = rsi.filter((v) => v !== null) as number[];
		expect(computed.length).toBeGreaterThan(0);
		for (const value of computed) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(100);
		}
	});

	test('result array length equals number of input candles', () => {
		const candles = makeCandles(Array.from({ length: 25 }, (_, i) => 100 + i));
		const rsi = service.calculateRsi(candles);
		expect(rsi.length).toBe(candles.length);
	});

	test('first 14 entries are null for a 20-candle series (default period=14)', () => {
		const candles = makeCandles(Array.from({ length: 20 }, (_, i) => 100 + i));
		const rsi = service.calculateRsi(candles);

		// Indices 0–13 should be null (warm-up); index 14 onward should be computed
		for (let i = 0; i < 14; i++) {
			expect(rsi[i]).toBeNull();
		}
		expect(rsi[14]).not.toBeNull();
	});

	test('all-gains series returns RSI of 100', () => {
		// Strictly rising prices mean avgLoss = 0 and avgGain > 0 → RSI = 100
		const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
		const candles = makeCandles(closes);
		const rsi = service.calculateRsi(candles);

		const computed = rsi.filter((v) => v !== null) as number[];
		expect(computed.length).toBeGreaterThan(0);
		for (const value of computed) {
			expect(value).toBe(100);
		}
	});
});
