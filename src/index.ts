import { createApp } from './app.ts';
import { StockService } from './stocks/service.ts';

const apiKey = process.env.ALPHA_VANTAGE_API_KEY ?? '';

const stockService = new StockService(apiKey);
const app = createApp(stockService);

const server = Bun.serve({
	port: 3000,
	fetch: app.fetch,
});

console.log(`Server running at http://localhost:${server.port}`);
