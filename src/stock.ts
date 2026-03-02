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

export async function fetchStockData(symbol: string, apiKey: string): Promise<StockData> {
	const [priceRes, rsiRes] = await Promise.all([
		fetch(
			`${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${apiKey}`,
		),
		fetch(
			`${BASE_URL}?function=RSI&symbol=${encodeURIComponent(symbol)}&interval=daily&time_period=14&series_type=close&apikey=${apiKey}`,
		),
	]);

	const [priceJson, rsiJson] = await Promise.all([
		priceRes.json() as Promise<Record<string, unknown>>,
		rsiRes.json() as Promise<Record<string, unknown>>,
	]);

	const timeSeries = priceJson['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined;
	if (!timeSeries) {
		const info =
			(priceJson['Information'] as string | undefined) ??
			(priceJson['Note'] as string | undefined) ??
			JSON.stringify(priceJson);
		throw new StockApiError(`Alpha Vantage price error: ${info}`);
	}

	const rsiSeries = rsiJson['Technical Analysis: RSI'] as Record<string, Record<string, string>> | undefined;
	if (!rsiSeries) {
		const info =
			(rsiJson['Information'] as string | undefined) ??
			(rsiJson['Note'] as string | undefined) ??
			JSON.stringify(rsiJson);
		throw new StockApiError(`Alpha Vantage RSI error: ${info}`);
	}

	const priceDates = Object.keys(timeSeries).sort().reverse().slice(0, 100);
	const rsiDateSet = new Set(Object.keys(rsiSeries));
	const commonDates = priceDates.filter((d) => rsiDateSet.has(d)).slice(0, 90);
	commonDates.sort();

	return {
		symbol: symbol.toUpperCase(),
		dates: commonDates,
		closes: commonDates.map((d) => parseFloat(timeSeries[d]!['4. close']!)),
		rsi: commonDates.map((d) => parseFloat(rsiSeries[d]!['RSI']!)),
	};
}
