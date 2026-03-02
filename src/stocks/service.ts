import type { Candle, RsiSignal } from './types.ts';

const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';
const FETCH_TIMEOUT_MS = 10_000;

export class StockService {
	constructor(private readonly apiKey: string) {}

	/**
	 * Fetch daily OHLCV candles from Alpha Vantage.
	 * Returns the last `days` trading days sorted oldest-first.
	 * Uses compact output (~100 data points); the caller slices to the desired window.
	 */
	async getCandles(symbol: string, days = 90): Promise<Candle[]> {
		const url = new URL(ALPHA_VANTAGE_BASE);
		url.searchParams.set('function', 'TIME_SERIES_DAILY');
		url.searchParams.set('symbol', symbol);
		url.searchParams.set('outputsize', 'compact');
		url.searchParams.set('apikey', this.apiKey);

		const res = await fetch(url.toString(), {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok) {
			throw new Error(`Alpha Vantage HTTP error: ${res.status}`);
		}

		const data = (await res.json()) as Record<string, unknown>;

		if ('Error Message' in data) {
			throw new Error(`Alpha Vantage: ${data['Error Message']}`);
		}
		// Both 'Note' (per-minute limit) and 'Information' (daily quota) signal rate limiting
		if ('Note' in data || 'Information' in data) {
			throw new Error('Alpha Vantage API call frequency limit reached');
		}

		const series = data['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined;
		if (!series) {
			throw new Error(`No time series data for symbol: ${symbol}`);
		}

		const allCandles: Candle[] = Object.entries(series)
			.sort(([a], [b]) => a.localeCompare(b)) // oldest first
			.map(([date, v]) => {
				const open = parseFloat(v['1. open'] ?? '');
				const high = parseFloat(v['2. high'] ?? '');
				const low = parseFloat(v['3. low'] ?? '');
				const close = parseFloat(v['4. close'] ?? '');
				const volume = parseInt(v['5. volume'] ?? '', 10);

				if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || isNaN(volume)) {
					throw new Error(`Invalid OHLCV data received for date: ${date}`);
				}

				return { date, open, high, low, close, volume };
			});

		// Return only the requested number of most-recent candles
		return allCandles.slice(-days);
	}

	/**
	 * Calculate Wilder's RSI-14 for an array of candles.
	 * Returns an array of the same length; the first `period` entries are null
	 * (insufficient data for calculation).
	 */
	calculateRsi(candles: Candle[], period = 14): (number | null)[] {
		const closes = candles.map((c) => c.close);
		const result: (number | null)[] = new Array(closes.length).fill(null);

		if (closes.length < period + 1) return result;

		// Price changes; closes[i] is always defined (i < closes.length - 1)
		const changes = closes.slice(1).map((close, i) => close - closes[i]!);

		// Seed: simple average of first `period` changes
		let avgGain = 0;
		let avgLoss = 0;
		for (let i = 0; i < period; i++) {
			// changes[i] is defined: i < period <= changes.length (guaranteed by length check)
			const change = changes[i]!;
			if (change > 0) avgGain += change;
			else avgLoss += Math.abs(change);
		}
		avgGain /= period;
		avgLoss /= period;

		// P0 fix: flat market (both gains and losses zero) => RSI 50, not 100
		const toRsi = (ag: number, al: number): number => {
			if (al === 0) return ag === 0 ? 50 : 100;
			return 100 - 100 / (1 + ag / al);
		};

		result[period] = toRsi(avgGain, avgLoss);

		// Wilder's smoothing for the rest
		for (let i = period; i < changes.length; i++) {
			// changes[i] is defined: i < changes.length
			const change = changes[i]!;
			const gain = change > 0 ? change : 0;
			const loss = change < 0 ? Math.abs(change) : 0;
			avgGain = (avgGain * (period - 1) + gain) / period;
			avgLoss = (avgLoss * (period - 1) + loss) / period;
			result[i + 1] = toRsi(avgGain, avgLoss);
		}

		return result;
	}

	/** Map an RSI value to a human-readable signal. */
	getRsiSignal(value: number): RsiSignal {
		if (value <= 30) return 'oversold';
		if (value >= 70) return 'overbought';
		return 'neutral';
	}
}
