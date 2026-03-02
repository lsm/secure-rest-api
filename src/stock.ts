const BASE_URL = 'https://www.alphavantage.co/query';

export interface StockData {
	symbol: string;
	dates: string[];
	closes: number[];
	rsi: number[];
}

export class StockApiError extends Error {
	constructor(
		message: string,
		public readonly statusCode: number = 502,
	) {
		super(message);
		this.name = 'StockApiError';
	}
}

function computeRSI(closes: number[], period = 14): number[] {
	if (closes.length <= period) return [];

	let avgGain = 0;
	let avgLoss = 0;
	for (let i = 1; i <= period; i++) {
		const change = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
		if (change > 0) avgGain += change;
		else avgLoss += Math.abs(change);
	}
	avgGain /= period;
	avgLoss /= period;

	const rsi: number[] = [];

	function rsiFromAvgs(g: number, l: number): number {
		if (g === 0 && l === 0) return 50;
		if (l === 0) return 100;
		return 100 - 100 / (1 + g / l);
	}

	rsi.push(rsiFromAvgs(avgGain, avgLoss));

	for (let i = period + 1; i < closes.length; i++) {
		const change = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
		const gain = change > 0 ? change : 0;
		const loss = change < 0 ? Math.abs(change) : 0;
		avgGain = (avgGain * (period - 1) + gain) / period;
		avgLoss = (avgLoss * (period - 1) + loss) / period;
		rsi.push(rsiFromAvgs(avgGain, avgLoss));
	}

	return rsi;
}

export async function fetchStockData(symbol: string, apiKey: string): Promise<StockData> {
	const url = `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${encodeURIComponent(apiKey)}`;
	const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new StockApiError(`Alpha Vantage HTTP ${res.status}`);

	const json = (await res.json()) as Record<string, unknown>;

	if (json['Note']) throw new StockApiError('Alpha Vantage rate limit reached. Please wait and retry.');
	if (json['Error Message']) throw new StockApiError(`Invalid symbol: ${symbol}`, 404);
	if (json['Information']) throw new StockApiError(json['Information'] as string);

	const timeSeries = json['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined;
	if (!timeSeries) throw new StockApiError('Unexpected Alpha Vantage response format.');

	const entries = Object.entries(timeSeries).sort(([a], [b]) => a.localeCompare(b));
	const allDates = entries.map(([d]) => d);
	const allCloses = entries.map(([, v]) => parseFloat(v['4. close'] ?? '0'));

	const rsiValues = computeRSI(allCloses);
	const offset = allCloses.length - rsiValues.length;
	const dates = allDates.slice(offset).slice(-100);
	const closes = allCloses.slice(offset).slice(-100);
	const rsi = rsiValues.slice(-100);

	return { symbol: symbol.toUpperCase(), dates, closes, rsi };
}
