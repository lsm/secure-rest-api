import index from "./index.html";

/** Wilder's smoothed RSI over `period` bars. Returns NaN for the first `period` entries. */
function calculateRSI(closes: number[], period = 14): number[] {
  const rsi = new Array<number>(closes.length).fill(NaN);
  if (closes.length < period + 1) return rsi;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    if (d > 0) gains += d;
    else losses -= d;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    const gain = Math.max(d, 0);
    const loss = Math.max(-d, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

const PORT = parseInt(process.env.PORT ?? "3000");

Bun.serve({
  routes: {
    "/": index,

    "/api/stock/:ticker": {
      GET: async (req) => {
        const ticker = req.params.ticker.toUpperCase();
        try {
          const url =
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
            `?range=6mo&interval=1d&includePrePost=false`;
          const yahooRes = await fetch(url, {
            signal: AbortSignal.timeout(8000),
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
              Accept: "application/json",
            },
          });

          if (!yahooRes.ok) {
            return Response.json(
              { error: `Ticker "${ticker}" not found or data unavailable` },
              { status: 404 }
            );
          }

          const json = await yahooRes.json();
          const result = json?.chart?.result?.[0];

          if (!result) {
            const desc: string =
              json?.chart?.error?.description ?? `No data found for "${ticker}"`;
            return Response.json({ error: desc }, { status: 404 });
          }

          const timestamps: number[] = result.timestamp ?? [];
          const quote = result.indicators?.quote?.[0];
          if (!quote) {
            return Response.json(
              { error: "Unexpected data shape from Yahoo Finance" },
              { status: 500 }
            );
          }

          const { open, high, low, close } = quote as {
            open: (number | null)[];
            high: (number | null)[];
            low: (number | null)[];
            close: (number | null)[];
          };

          const candles = timestamps
            .map((t, i) => ({
              time: t,
              open: open[i],
              high: high[i],
              low: low[i],
              close: close[i],
            }))
            .filter(
              (c): c is { time: number; open: number; high: number; low: number; close: number } =>
                c.open != null && c.high != null && c.low != null && c.close != null
            );

          const rsiValues = calculateRSI(candles.map((c) => c.close));
          const rsi = candles
            .map((c, i) => ({ time: c.time, value: rsiValues[i] ?? NaN }))
            .filter((r) => !isNaN(r.value));

          const lastRSI = rsi[rsi.length - 1];
          const currentRSI = lastRSI != null ? lastRSI.value : null;
          return Response.json({ ticker, candles, rsi, currentRSI });
        } catch (err) {
          console.error("Stock fetch error:", err);
          return Response.json({ error: "Failed to fetch stock data" }, { status: 500 });
        }
      },
    },
  },
  development: process.env.NODE_ENV !== "production" ? { hmr: true, console: true } : undefined,
  port: PORT,
});

console.log(`Stock RSI server → http://localhost:${PORT}`);
