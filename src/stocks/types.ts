export interface OHLCVCandle {
	date: string;    // YYYY-MM-DD
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export interface StockQuote {
	symbol: string;
	lastRefreshed: string;
	candles: OHLCVCandle[];
}

export interface DateRange {
	startDate?: string;  // YYYY-MM-DD inclusive
	endDate?: string;    // YYYY-MM-DD inclusive
}
