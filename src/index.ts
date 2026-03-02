import { createApp } from './app.ts';
import { StockService } from './stocks/service.ts';

const apiKey = Bun.env.ALPHA_VANTAGE_API_KEY;
if (!apiKey) throw new Error('ALPHA_VANTAGE_API_KEY is required');

const stockService = new StockService(apiKey);
const app = createApp(stockService);

const server = Bun.serve({
	port: Number(Bun.env.PORT ?? 3000),
	fetch: app.fetch,
});

console.log(`Server running at http://localhost:${server.port}`);
