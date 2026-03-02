# Stock RSI Analyzer

A full-stack web app that displays a 6-month candlestick price chart and RSI(14) sub-panel for any stock ticker. Built with Bun, React, and [lightweight-charts](https://github.com/tradingview/lightweight-charts).

## Setup

```bash
bun install
```

## Run

```bash
bun run index.ts
# or with a custom port:
PORT=4000 bun run index.ts
```

Then open **http://localhost:3000** in your browser.

For development with hot-reload:

```bash
bun run dev
```

## Frontend files

| File | Purpose |
|------|---------|
| `index.html` | HTML entry point — Bun's bundler transpiles and serves `frontend.tsx` and `styles.css` automatically |
| `frontend.tsx` | React app: ticker search bar, candlestick price chart, RSI sub-panel with overbought/oversold lines, RSI badge |
| `styles.css` | Dark-themed responsive two-panel layout |

## API

`GET /api/stock/:ticker` — proxies 6 months of OHLCV data from Yahoo Finance, computes RSI(14) server-side using Wilder's smoothing, and returns:

```json
{
  "ticker": "AAPL",
  "candles": [{ "time": 1693785600, "open": 189.49, "high": 189.60, "low": 188.55, "close": 189.46 }, ...],
  "rsi":     [{ "time": 1694995200, "value": 48.22 }, ...],
  "currentRSI": 48.22
}
```

## Tests

```bash
bun test
```

## Tech stack

- **Runtime / bundler**: [Bun](https://bun.com)
- **Frontend**: React 19, [lightweight-charts](https://github.com/tradingview/lightweight-charts) v5
- **Backend API**: `Bun.serve()` with built-in HTML imports
- **Data source**: Yahoo Finance (unofficial JSON API, proxied server-side)
