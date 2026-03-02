import { fetchStockData, StockApiError } from './stock.ts';
import { RateLimiter } from './rate-limit/index.ts';

const PORT = parseInt(process.env.PORT || '3000');

// 30 requests per minute per IP for the stock API
const stockLimiter = new RateLimiter({ windowMs: 60_000, max: 30 });
stockLimiter.startCleanup();

function getClientIp(req: Request): string {
	return req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
}

Bun.serve({
	port: PORT,
	routes: {
		'/api/stock/:symbol': async (req) => {
			const ip = getClientIp(req);
			const rl = stockLimiter.check(ip);
			if (!rl.allowed) {
				const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
				return Response.json(
					{ error: 'Too many requests, please try again later.' },
					{
						status: 429,
						headers: {
							'Retry-After': String(Math.max(retryAfter, 1)),
							'X-RateLimit-Limit': String(rl.total),
							'X-RateLimit-Remaining': '0',
							'X-RateLimit-Reset': String(Math.ceil(rl.resetAt / 1000)),
						},
					},
				);
			}

			const symbol = (req as Request & { params?: Record<string, string> }).params?.symbol ?? '';
			if (!symbol || !/^[A-Z0-9.^-]{1,12}$/i.test(symbol)) {
				return Response.json({ error: 'Invalid symbol' }, { status: 400 });
			}

			try {
				const apiKey = process.env.ALPHA_VANTAGE_API_KEY || 'demo';
				const data = await fetchStockData(symbol, apiKey);
				return Response.json(data);
			} catch (err) {
				if (err instanceof StockApiError) {
					return Response.json({ error: err.message }, { status: err.statusCode });
				}
				return Response.json({ error: 'Internal server error' }, { status: 502 });
			}
		},
		'/': () => new Response(Bun.file('./public/index.html')),
	},
});

console.log(`Stock RSI server running at http://localhost:${PORT}`);
