import { createApp } from './app.ts';
import { StockService } from './stocks/service.ts';

const apiKey = Bun.env.ALPHA_VANTAGE_API_KEY?.trim();
if (!apiKey) throw new Error('ALPHA_VANTAGE_API_KEY is required');

const stockService = new StockService(apiKey);
const app = createApp(stockService);

const rawPort = Bun.env.PORT;
const port = rawPort ? Number(rawPort) : 3000;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = Bun.serve({
	port,
	fetch: app.fetch,
});

console.log(`Server running at http://localhost:${server.port}`);
