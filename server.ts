import index from "./index.html";

interface YFQuote {
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  volume: (number | null)[];
}

interface YFResult {
  meta: { regularMarketPrice: number; symbol: string };
  timestamp: number[];
  indicators: { quote: YFQuote[] };
}

interface YFChart {
  chart: {
    result?: YFResult[];
    error?: { code: string; description: string };
  };
}

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface RSIPoint {
  time: string;
  value: number;
}

function calculateRSI(closes: number[], period = 14): (number | null)[] {
  if (closes.length < period + 1) return closes.map(() => null);

  const rsi: (number | null)[] = new Array(period).fill(null);

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }

  return rsi;
}

function toDateStr(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

Bun.serve({
  port: Number(process.env.PORT) || 3000,
  routes: {
    "/": index,
    "/api/stock/:ticker": {
      GET: async (req) => {
        const ticker = req.params.ticker.toUpperCase();
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=6mo`;

        let data: YFChart;
        try {
          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept: "application/json",
              "Accept-Language": "en-US,en;q=0.9",
            },
          });
          if (!res.ok) {
            return Response.json(
              { error: `Ticker "${ticker}" not found or data unavailable` },
              { status: 404 }
            );
          }
          data = (await res.json()) as YFChart;
        } catch {
          return Response.json(
            { error: "Network error fetching stock data" },
            { status: 502 }
          );
        }

        if (data.chart.error || !data.chart.result?.length) {
          return Response.json(
            { error: `Ticker "${ticker}" not found` },
            { status: 404 }
          );
        }

        const result = data.chart.result[0];
        const timestamps = result.timestamp;
        const quote = result.indicators.quote[0];

        const candles: Candle[] = [];
        const cleanCloses: number[] = [];

        for (let i = 0; i < timestamps.length; i++) {
          const o = quote.open[i];
          const h = quote.high[i];
          const l = quote.low[i];
          const c = quote.close[i];
          if (o == null || h == null || l == null || c == null) continue;
          candles.push({ time: toDateStr(timestamps[i]), open: o, high: h, low: l, close: c });
          cleanCloses.push(c);
        }

        if (candles.length < 16) {
          return Response.json({ error: "Insufficient data for RSI calculation" }, { status: 400 });
        }

        const rsiValues = calculateRSI(cleanCloses);
        const rsi: RSIPoint[] = candles
          .map((bar, i) => ({ time: bar.time, value: rsiValues[i] }))
          .filter((d): d is RSIPoint => d.value !== null);

        const currentRSI = rsiValues[rsiValues.length - 1] ?? null;

        return Response.json({ candles, rsi, currentRSI });
      },
    },
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

const port = Number(process.env.PORT) || 3000;
console.log(`Server running at http://localhost:${port}`);
