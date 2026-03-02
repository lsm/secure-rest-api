import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type Time,
} from "lightweight-charts";
import "./styles.css";

// ── Types ──────────────────────────────────────────────

interface StockPayload {
  candles: CandlestickData<Time>[];
  rsi: LineData<Time>[];
  currentRSI: number | null;
}

// ── RSI badge helpers ──────────────────────────────────

function rsiBadgeClass(rsi: number | null): string {
  if (rsi === null) return "rsi-badge rsi-neutral";
  if (rsi >= 70) return "rsi-badge rsi-overbought";
  if (rsi <= 30) return "rsi-badge rsi-oversold";
  return "rsi-badge rsi-neutral";
}

function rsiLabel(rsi: number | null): string {
  if (rsi === null) return "—";
  const tag = rsi >= 70 ? " Overbought" : rsi <= 30 ? " Oversold" : "";
  return `${rsi.toFixed(2)}${tag}`;
}

// ── Chart dark theme ───────────────────────────────────

const DARK_OPTS = {
  layout: {
    background: { color: "#1a1a2e" },
    textColor: "#8888aa",
  },
  grid: {
    vertLines: { color: "#252540" },
    horzLines: { color: "#252540" },
  },
  rightPriceScale: {
    borderColor: "#2a2a4e",
  },
  timeScale: {
    borderColor: "#2a2a4e",
    rightOffset: 10,
    barSpacing: 8,
  },
} as const;

// ── App ────────────────────────────────────────────────

export default function App() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StockPayload | null>(null);

  // DOM refs for chart containers
  const priceRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);

  // Chart instance refs (never trigger re-renders)
  const priceChart = useRef<IChartApi | null>(null);
  const rsiChart = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const rsiLineSeries = useRef<ISeriesApi<"Line"> | null>(null);

  // ── Initialize charts once ────────────────────────────

  useEffect(() => {
    if (!priceRef.current || !rsiRef.current) return;

    // Price chart
    const pc = createChart(priceRef.current, {
      ...DARK_OPTS,
      autoSize: true,
      height: 380,
    });
    priceChart.current = pc;

    candleSeries.current = pc.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    // RSI chart
    const rc = createChart(rsiRef.current, {
      ...DARK_OPTS,
      autoSize: true,
      height: 160,
      rightPriceScale: {
        ...DARK_OPTS.rightPriceScale,
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
    });
    rsiChart.current = rc;

    const rsl = rc.addSeries(LineSeries, {
      color: "#7c4dff",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      // Pin y-axis to 0–100 regardless of data range
      autoscaleInfoProvider: () => ({
        priceRange: { minValue: 0, maxValue: 100 },
        margins: { above: 10, below: 10 },
      }),
    });
    rsiLineSeries.current = rsl;

    // Overbought reference line at 70 (dashed red)
    rsl.createPriceLine({
      price: 70,
      color: "#ef5350",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "OB 70",
    });

    // Oversold reference line at 30 (dashed green)
    rsl.createPriceLine({
      price: 30,
      color: "#26a69a",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "OS 30",
    });

    return () => {
      pc.remove();
      rc.remove();
    };
  }, []);

  // ── Sync data into charts whenever it changes ─────────

  useEffect(() => {
    if (!data) return;
    candleSeries.current?.setData(data.candles);
    rsiLineSeries.current?.setData(data.rsi);

    // Fit both time scales
    priceChart.current?.timeScale().fitContent();
    rsiChart.current?.timeScale().fitContent();

  }, [data]);

  // ── Fetch handler ──────────────────────────────────────

  const handleSearch = useCallback(async () => {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch(`/api/stock/${sym}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      setData(json as StockPayload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1>Stock RSI Analyzer</h1>
        <div className="search-bar">
          <input
            type="text"
            className="search-input"
            placeholder="Ticker symbol, e.g. AAPL"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyDown={handleKey}
            aria-label="Stock ticker symbol"
          />
          <button
            className="search-button"
            onClick={handleSearch}
            disabled={loading || !ticker.trim()}
          >
            {loading ? "Loading…" : "Search"}
          </button>
        </div>
      </header>

      <main>
        {/* Loading spinner */}
        {loading && (
          <div className="loading" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <span>Fetching {ticker}…</span>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}

        {/* RSI badge */}
        {data && !loading && (
          <div className="rsi-badge-row">
            <span className="rsi-label">RSI (14)</span>
            <span className={rsiBadgeClass(data.currentRSI)}>
              {rsiLabel(data.currentRSI)}
            </span>
          </div>
        )}

        {/* Charts — always rendered so refs are stable */}
        <div
          className="charts-wrapper"
          style={{ display: data && !loading ? "flex" : "none" }}
        >
          {/* Price panel */}
          <div className="chart-panel">
            <div className="chart-panel-header">
              <span className="chart-panel-title">Price — {ticker}</span>
            </div>
            <div ref={priceRef} className="chart-host" style={{ height: 380 }} />
          </div>

          {/* RSI panel */}
          <div className="chart-panel">
            <div className="chart-panel-header">
              <span className="chart-panel-title">RSI (14)</span>
            </div>
            <div ref={rsiRef} className="chart-host" style={{ height: 160 }} />
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Mount ──────────────────────────────────────────────

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("No #root element found");
createRoot(rootEl).render(<App />);
