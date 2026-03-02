import { Hono } from 'hono';
import type { StockService } from './service.ts';

/**
 * Returns a Hono sub-router for stock endpoints.
 * Mount at `/api/stocks` in the parent app.
 *
 * Routes:
 *   GET /:symbol       — 90-day OHLCV candles + aligned RSI array
 *   GET /:symbol/rsi   — latest RSI value, signal, and date
 */
export function createStocksRouter(stockService: StockService): Hono {
	const router = new Hono();

	// Apply Cache-Control to all responses (including error paths)
	router.use('/*', async (c, next) => {
		c.header('Cache-Control', 'no-store');
		await next();
	});

	router.get('/:symbol', async (c) => {
		const symbol = c.req.param('symbol').toUpperCase();

		// Symbol already uppercased — no /i flag needed
		if (!/^[A-Z0-9.]{1,10}$/.test(symbol)) {
			return c.json({ error: 'Invalid symbol' }, 400);
		}

		let rawCandles;
		try {
			// Fetch 104 candles (90 desired + 14 RSI warmup) using full outputsize
			rawCandles = await stockService.getCandles(symbol, 104);
		} catch (error) {
			console.error('StockService error:', error);
			return c.json({ error: 'Failed to fetch stock data' }, 502);
		}

		const rsiAll = stockService.calculateRsi(rawCandles);

		// Strip leading null-warmup entries so candles and rsi arrays are 1-to-1
		const firstValid = rsiAll.findIndex((v) => v !== null);
		const candles = firstValid === -1 ? rawCandles : rawCandles.slice(firstValid);
		const rsi = firstValid === -1 ? rsiAll : rsiAll.slice(firstValid);

		return c.json({ symbol, candles: candles.slice(-90), rsi: rsi.slice(-90) });
	});

	router.get('/:symbol/rsi', async (c) => {
		const symbol = c.req.param('symbol').toUpperCase();

		if (!/^[A-Z0-9.]{1,10}$/.test(symbol)) {
			return c.json({ error: 'Invalid symbol' }, 400);
		}

		let candles;
		try {
			// Fetch 104 candles (90 desired + 14 RSI warmup) using full outputsize
			candles = await stockService.getCandles(symbol, 104);
		} catch (error) {
			console.error('StockService error:', error);
			return c.json({ error: 'Failed to fetch stock data' }, 502);
		}

		const rsiValues = stockService.calculateRsi(candles);

		// Find the latest non-null RSI value and its corresponding candle date
		let latestRsi: number | null = null;
		let latestDate = '';
		for (let i = rsiValues.length - 1; i >= 0; i--) {
			if (rsiValues[i] !== null) {
				latestRsi = rsiValues[i] as number;
				latestDate = candles[i]?.date ?? '';
				break;
			}
		}

		if (latestRsi === null) {
			return c.json({ error: 'Insufficient data to calculate RSI' }, 422);
		}

		const signal = stockService.getRsiSignal(latestRsi);
		return c.json({ symbol, date: latestDate, rsi: latestRsi, signal });
	});

	return router;
}
