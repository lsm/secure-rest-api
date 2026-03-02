import { fetchStockData, StockApiError } from './stock.ts';

const PORT = parseInt(process.env.PORT || '3000');

Bun.serve({
	port: PORT,
	routes: {
		'/api/stock/:symbol': async (req) => {
			const symbol = new URL(req.url).pathname.split('/').pop() ?? '';
			if (!symbol) {
				return Response.json({ error: 'Missing symbol' }, { status: 400 });
			}
			try {
				const apiKey = process.env.ALPHA_VANTAGE_API_KEY || 'demo';
				const data = await fetchStockData(symbol, apiKey);
				return Response.json(data);
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Unknown error';
				const status = err instanceof StockApiError ? err.statusCode : 502;
				return Response.json({ error: message }, { status });
			}
		},
		'/': () => new Response(Bun.file('./public/index.html')),
	},
});

console.log(`Stock RSI server running at http://localhost:${PORT}`);
