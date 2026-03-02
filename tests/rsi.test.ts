import { test, expect, describe } from "bun:test";
import { calculateRSI, rsiSignal } from "../src/stocks/rsi";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert two numbers are within `tolerance` of each other. */
function expectClose(actual: number | null, expected: number, tolerance = 0.01) {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThan(tolerance);
}

// ---------------------------------------------------------------------------
// Scenario 1: Standard 14-period RSI with a known reference dataset
//
// Prices sourced from a widely-cited RSI example (Wilder's original method).
// Expected values computed by hand and cross-checked against the algorithm.
//
// Prices (16 values):
//   44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.15,
//   43.61, 44.33, 44.83, 45.10, 45.15, 45.20, 45.50, 45.21
//
// First 14 changes → seed:
//   gains  = 0.06+0.72+0.50+0.27+0.05+0.72+0.50+0.27+0.05+0.05+0.30 = 3.49
//   losses = 0.25+0.54+1.54                                           = 2.33
//   avgGain = 3.49/14 ≈ 0.24929,  avgLoss = 2.33/14 ≈ 0.16643
//   RSI[14] = 100 – 100/(1 + 0.24929/0.16643) ≈ 59.97
//
// Change[14] = 45.21 – 45.50 = –0.29 (pure loss)
//   avgGain' = (0.24929×13 + 0) / 14 ≈ 0.23148
//   avgLoss' = (0.16643×13 + 0.29) / 14 ≈ 0.17526
//   RSI[15] ≈ 56.91
// ---------------------------------------------------------------------------

const REFERENCE_PRICES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.15,
  43.61, 44.33, 44.83, 45.10, 45.15, 45.20, 45.50, 45.21,
];

describe("calculateRSI – standard 14-period", () => {
  const rsi = calculateRSI(REFERENCE_PRICES);

  test("returns same-length array", () => {
    expect(rsi).toHaveLength(REFERENCE_PRICES.length);
  });

  test("first 14 entries are null (warm-up period)", () => {
    for (let i = 0; i < 14; i++) {
      expect(rsi[i]).toBeNull();
    }
  });

  test("RSI at index 14 ≈ 59.97", () => {
    expectClose(rsi[14], 59.97);
  });

  test("RSI at index 15 ≈ 56.91", () => {
    expectClose(rsi[15], 56.91);
  });

  test("all non-null RSI values are in range 0–100", () => {
    for (const v of rsi) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Overbought / oversold detection
// ---------------------------------------------------------------------------

describe("rsiSignal – overbought / oversold detection", () => {
  // 16 prices that only rise → all changes are gains → RSI = 100
  const risingPrices = Array.from({ length: 16 }, (_, i) => 100 + i);
  const rsiRising = calculateRSI(risingPrices);

  // 16 prices that only fall → all changes are losses → RSI = 0
  const fallingPrices = Array.from({ length: 16 }, (_, i) => 115 - i);
  const rsiFalling = calculateRSI(fallingPrices);

  test("pure up-trend produces RSI = 100 (overbought)", () => {
    const val = rsiRising[15] as number;
    expect(val).toBe(100);
    expect(rsiSignal(val)).toBe("overbought");
  });

  test("pure down-trend produces RSI = 0 (oversold)", () => {
    const val = rsiFalling[15] as number;
    expect(val).toBe(0);
    expect(rsiSignal(val)).toBe("oversold");
  });

  test("rsiSignal returns 'overbought' for value ≥ 70", () => {
    expect(rsiSignal(70)).toBe("overbought");
    expect(rsiSignal(85)).toBe("overbought");
    expect(rsiSignal(100)).toBe("overbought");
  });

  test("rsiSignal returns 'oversold' for value ≤ 30", () => {
    expect(rsiSignal(30)).toBe("oversold");
    expect(rsiSignal(15)).toBe("oversold");
    expect(rsiSignal(0)).toBe("oversold");
  });

  test("rsiSignal returns 'neutral' for values between 30 and 70", () => {
    expect(rsiSignal(31)).toBe("neutral");
    expect(rsiSignal(50)).toBe("neutral");
    expect(rsiSignal(69)).toBe("neutral");
  });

  // Sanity-check using the reference dataset (RSI ≈ 56.91 and 59.97 → neutral)
  test("reference dataset RSI values are neutral", () => {
    const val14 = rsiRising[14] as number;
    // Rising dataset: RSI at index 14 is 100 → overbought
    expect(rsiSignal(val14)).toBe("overbought");

    const refVal = calculateRSI(REFERENCE_PRICES)[14] as number;
    expect(rsiSignal(refVal)).toBe("neutral");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Edge cases
// ---------------------------------------------------------------------------

describe("calculateRSI – edge cases", () => {
  test("fewer prices than period returns all-null array", () => {
    const prices = [44.34, 44.09, 44.15]; // only 3 prices, period=14
    const result = calculateRSI(prices);
    expect(result).toHaveLength(3);
    expect(result.every((v) => v === null)).toBe(true);
  });

  test("exactly `period` prices returns all-null array", () => {
    const prices = Array.from({ length: 14 }, (_, i) => 100 + i);
    const result = calculateRSI(prices, 14);
    expect(result).toHaveLength(14);
    expect(result.every((v) => v === null)).toBe(true);
  });

  test("period + 1 prices yields exactly one non-null value at end", () => {
    const prices = Array.from({ length: 15 }, (_, i) => 100 + i);
    const result = calculateRSI(prices, 14);
    expect(result).toHaveLength(15);
    expect(result[14]).not.toBeNull();
    expect(result.slice(0, 14).every((v) => v === null)).toBe(true);
  });

  test("custom period is respected", () => {
    const prices = [10, 11, 10, 11, 10, 11]; // 6 prices, period=5
    const result = calculateRSI(prices, 5);
    expect(result).toHaveLength(6);
    // First 5 are null, last one has a value
    expect(result.slice(0, 5).every((v) => v === null)).toBe(true);
    expect(result[5]).not.toBeNull();
  });

  test("constant prices (no change) returns RSI = 100 after seed (all gains = 0, losses = 0)", () => {
    // When both avgGain and avgLoss are 0, avgLoss===0 branch → RSI = 100
    const prices = Array.from({ length: 16 }, () => 50);
    const result = calculateRSI(prices);
    for (let i = 14; i < 16; i++) {
      expect(result[i]).toBe(100);
    }
  });
});
