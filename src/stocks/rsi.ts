/**
 * Relative Strength Index (RSI) calculation using Wilder's smoothing method.
 * Matches standard broker chart implementations.
 */

export type RSISignal = "overbought" | "oversold" | "neutral";

/**
 * Calculate RSI for an array of closing prices.
 *
 * Uses Wilder's smoothing (EMA-style):
 *   - Initial avg gain/loss: simple average of first `period` price changes
 *   - Subsequent values: (prev_avg * (period - 1) + current) / period
 *
 * @param prices  Array of closing prices (oldest first)
 * @param period  Lookback period (default 14)
 * @returns Array of same length as prices; first `period` entries are null
 */
export function calculateRSI(prices: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(prices.length).fill(null);

  // Need at least period+1 prices to produce one RSI value
  if (prices.length <= period) {
    return result;
  }

  // Compute price changes (length = prices.length - 1)
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  // Seed: simple average of first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      avgGain += changes[i];
    } else {
      avgLoss += Math.abs(changes[i]);
    }
  }
  avgGain /= period;
  avgLoss /= period;

  // First RSI value sits at index `period`
  result[period] = rsiFromAvgs(avgGain, avgLoss);

  // Wilder's smoothing for subsequent values
  for (let i = period + 1; i < prices.length; i++) {
    const change = changes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    result[i] = rsiFromAvgs(avgGain, avgLoss);
  }

  return result;
}

function rsiFromAvgs(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Interpret an RSI value as a trading signal.
 *
 * @param value  RSI value (0–100)
 * @returns "overbought" if ≥70, "oversold" if ≤30, otherwise "neutral"
 */
export function rsiSignal(value: number): RSISignal {
  if (value >= 70) return "overbought";
  if (value <= 30) return "oversold";
  return "neutral";
}
