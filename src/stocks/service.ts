import type { Candle, RsiSignal } from './types.ts';

const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';

export class StockService {
	constructor(private readonly apiKey: string) {}

	/**
	 * Fetch daily OHLCV candles from Alpha Vantage.
	 * Returns the last `days` trading days sorted oldest-first.
	 * Fetches compact output (100 days) so RSI has sufficient warmup data;
	 * the caller slices to the desired window.
	 */
	async getCandles(symbol: string, days = 90): Promise<Candle[]> {
		const url = new URL(ALPHA_VANTAGE_BASE);
		url.searchParams.set('function', 'TIME_SERIES_DAILY');
		url.searchParams.set('symbol', symbol);
		url.searchParams.set('outputsize', 'compact'); // ~100 trading days
		url.searchParams.set('apikey', this.apiKey);

		const res = await fetch(url.toString());
		if (!res.ok) {
			throw new Error(`Alpha Vantage HTTP error: ${res.status}`);
		}

		const data = (await res.json()) as Record<string, unknown>;

		if ('Error Message' in data) {
			throw new Error(`Alpha Vantage: ${data['Error Message']}`);
		}
		if ('Note' in data) {
			throw new Error('Alpha Vantage API call frequency limit reached');
		}

		const series = data['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined;
		if (!series) {
			throw new Error(`No time series data for symbol: ${symbol}`);
		}

		const allCandles: Candle[] = Object.entries(series)
			.sort(([a], [b]) => a.localeCompare(b)) // oldest first
			.map(([date, v]) => ({
				date,
				open: parseFloat(v['1. open']),
				high: parseFloat(v['2. high']),
				low: parseFloat(v['3. low']),
				close: parseFloat(v['4. close']),
				volume: parseInt(v['5. volume'], 10),
			}));

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

		// Price changes (length = closes.length - 1)
		const changes = closes.slice(1).map((close, i) => close - closes[i]);

		// Seed: simple average of first `period` changes
		let avgGain = 0;
		let avgLoss = 0;
		for (let i = 0; i < period; i++) {
			if (changes[i] > 0) avgGain += changes[i];
			else avgLoss += Math.abs(changes[i]);
		}
		avgGain /= period;
		avgLoss /= period;

		const toRsi = (ag: number, al: number) =>
			al === 0 ? 100 : 100 - 100 / (1 + ag / al);

		result[period] = toRsi(avgGain, avgLoss);

		// Wilder's smoothing for the rest
		for (let i = period; i < changes.length; i++) {
			const gain = changes[i] > 0 ? changes[i] : 0;
			const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
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
