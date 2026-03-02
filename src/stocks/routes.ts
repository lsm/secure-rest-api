import { Hono } from 'hono';
import type { StockService } from './service.ts';

/**
 * Returns a Hono sub-router for stock endpoints.
 * Mount at `/api/stocks` in the parent app.
 *
 * Routes:
 *   GET /:symbol       — 90-day OHLCV candles + aligned RSI array
 *   GET /:symbol/rsi   — latest RSI value and signal
 */
export function createStocksRouter(stockService: StockService): Hono {
	const router = new Hono();

	router.get('/:symbol', async (c) => {
		const symbol = c.req.param('symbol').toUpperCase();

		let candles;
		try {
			candles = await stockService.getCandles(symbol);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to fetch stock data';
			return c.json({ error: message }, 502);
		}

		const rsi = stockService.calculateRsi(candles);
		return c.json({ symbol, candles, rsi });
	});

	router.get('/:symbol/rsi', async (c) => {
		const symbol = c.req.param('symbol').toUpperCase();

		let candles;
		try {
			candles = await stockService.getCandles(symbol);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to fetch stock data';
			return c.json({ error: message }, 502);
		}

		const rsiValues = stockService.calculateRsi(candles);

		// Find the latest non-null RSI value
		let latestRsi: number | null = null;
		for (let i = rsiValues.length - 1; i >= 0; i--) {
			if (rsiValues[i] !== null) {
				latestRsi = rsiValues[i] as number;
				break;
			}
		}

		if (latestRsi === null) {
			return c.json({ error: 'Insufficient data to calculate RSI' }, 422);
		}

		const signal = stockService.getRsiSignal(latestRsi);
		return c.json({ symbol, rsi: latestRsi, signal });
	});

	return router;
}
