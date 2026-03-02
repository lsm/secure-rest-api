import { Hono } from 'hono';
import { createApiRateLimiter } from './rate-limit/index.ts';
import { createStocksRouter } from './stocks/routes.ts';
import type { StockService } from './stocks/service.ts';

/**
 * Build and return the Hono application.
 * Accepts a StockService instance so tests can inject a mock.
 */
export function createApp(stockService: StockService): Hono {
	const app = new Hono();

	// Apply rate limiting to all /api/* routes
	app.use('/api/*', createApiRateLimiter());

	// Stock routes
	app.route('/api/stocks', createStocksRouter(stockService));

	// Root: serve the frontend HTML dashboard
	app.get('/', async (c) => {
		const html = await Bun.file(new URL('../index.html', import.meta.url)).text();
		return c.html(html);
	});

	return app;
}
