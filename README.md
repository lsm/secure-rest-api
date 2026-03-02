# Stock RSI Viewer

A web app that fetches stock price history from [Alpha Vantage](https://www.alphavantage.co/) and renders a price chart alongside a 14-period RSI indicator.

## Features

- Search any ticker symbol (e.g. AAPL, TSLA, MSFT)
- Displays the last 100 daily closing prices as a line chart
- Calculates and charts the 14-period RSI using Wilder smoothing
- Visual overbought (>70) and oversold (<30) zones on the RSI chart

## Getting Started

### 1. Clone the repository

```bash
git clone <repo-url>
cd <repo-directory>
```

### 2. Install dependencies

```bash
bun install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your Alpha Vantage API key:

```
ALPHA_VANTAGE_API_KEY=your_actual_key_here
PORT=3000
```

You can get a free API key at <https://www.alphavantage.co/support/#api-key>.

### 4. Start the development server

```bash
bun run dev
```

The app will be available at <http://localhost:3000>.

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start with hot-reload (development) |
| `bun run start` | Start without hot-reload (production) |
| `bun test` | Run the test suite |
| `bun run test:coverage` | Run tests with coverage report |

## Project Structure

```
src/
  index.ts          # Server entry point (Bun.serve + RSI API)
  auth/             # JWT authentication module
  db/               # In-memory database schema
  rate-limit/       # Sliding-window rate limiter
tests/              # Unit tests
.env.example        # Environment variable template
```

## API

### `GET /api/rsi?symbol=<TICKER>`

Returns the last 100 data points for the given ticker.

**Response**

```json
{
  "symbol": "AAPL",
  "dates": ["2024-10-01", "..."],
  "closes": [226.51, "..."],
  "rsi": [null, "...", 62.4]
}
```

RSI values are `null` for the first 14 data points (warm-up period).
