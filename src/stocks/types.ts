export interface Candle {
	date: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export type RsiSignal = 'oversold' | 'neutral' | 'overbought';
