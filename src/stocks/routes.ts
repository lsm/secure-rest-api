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

		if (!/^[A-Z0-9.]{1,10}$/i.test(symbol)) {
			return c.json({ error: 'Invalid symbol' }, 400);
		}

		let rawCandles;
		try {
			// Fetch extra candles for RSI warmup (14 extra for period=14)
			rawCandles = await stockService.getCandles(symbol, 104);
		} catch (error) {
			console.error('StockService error:', error);
			return c.json({ error: 'Failed to fetch stock data' }, 502);
		}

		const rsiAll = stockService.calculateRsi(rawCandles);

		// Slice to the last 90 entries that have a valid (non-null) RSI value
		const firstValid = rsiAll.findIndex((v) => v !== null);
		const candles = firstValid === -1 ? rawCandles : rawCandles.slice(firstValid);
		const rsi = firstValid === -1 ? rsiAll : rsiAll.slice(firstValid);

		c.header('Cache-Control', 'no-store');
		return c.json({ symbol, candles: candles.slice(-90), rsi: rsi.slice(-90) });
	});

	router.get('/:symbol/rsi', async (c) => {
		const symbol = c.req.param('symbol').toUpperCase();

		if (!/^[A-Z0-9.]{1,10}$/i.test(symbol)) {
			return c.json({ error: 'Invalid symbol' }, 400);
		}

		let candles;
		try {
			// Fetch extra candles for RSI warmup (14 extra for period=14)
			candles = await stockService.getCandles(symbol, 104);
		} catch (error) {
			console.error('StockService error:', error);
			return c.json({ error: 'Failed to fetch stock data' }, 502);
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
		c.header('Cache-Control', 'no-store');
		return c.json({ symbol, rsi: latestRsi, signal });
	});

	return router;
}
