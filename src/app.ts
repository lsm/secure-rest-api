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

	// Root: serve a minimal placeholder until the frontend build is wired up
	app.get('/', (c) =>
		c.html(
			`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stock RSI App</title>
</head>
<body>
  <h1>Stock RSI App</h1>
  <p>API available at <code>/api/stocks/:symbol</code></p>
</body>
</html>`,
		),
	);

	return app;
}
