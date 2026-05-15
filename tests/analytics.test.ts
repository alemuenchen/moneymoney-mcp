import { describe, it, expect } from "vitest";
import { __test__ } from "../src/lib/analytics.js";

const { normalizeName, amountsClose, clusterAmounts, classifyCadence, daysBetween } = __test__;

// Pure-function tests for the analytics building blocks. The tools that wrap
// these (get_recurring / top_counterparties / compare_periods) call
// fetchTransactions which needs MoneyMoney running; those would belong in an
// integration test suite. Here we verify that the bucketing / normalization
// is sane.

describe("normalizeName", () => {
  it("uppercases and trims", () => {
    expect(normalizeName("amazon mktp de  ")).toBe("AMAZON MKTP DE");
  });

  it("strips trailing booking codes (4+ digits)", () => {
    expect(normalizeName("AMZN MKTP DE 5478291")).toBe("AMZN MKTP DE");
    expect(normalizeName("AMZN MKTP DE 9981212")).toBe("AMZN MKTP DE");
  });

  it("collapses multiple internal spaces", () => {
    expect(normalizeName("Netflix    Subscription")).toBe("NETFLIX SUBSCRIPTION");
  });

  it("does not strip single-digit suffixes (e.g. branch numbers)", () => {
    // "Filiale 1" should keep "1" — strip rule is 4+ digits
    expect(normalizeName("Lidl Filiale 1")).toBe("LIDL FILIALE 1");
  });

  it("caps at 50 characters", () => {
    const longName = "A".repeat(80);
    expect(normalizeName(longName).length).toBeLessThanOrEqual(50);
  });
});

describe("amountsClose", () => {
  it("considers values within 5% as close", () => {
    expect(amountsClose(-11.99, -12.0)).toBe(true);
    expect(amountsClose(2500, 2495)).toBe(true);
    expect(amountsClose(100, 104)).toBe(true);
  });

  it("uses absolute floor of 1.0 for small amounts", () => {
    // 0.50 and 1.00 differ by 0.50, within the absolute floor of 1.0
    expect(amountsClose(-0.5, -1.0)).toBe(true);
  });

  it("rejects clearly different amounts", () => {
    expect(amountsClose(-15, -25)).toBe(false);
    expect(amountsClose(100, 200)).toBe(false);
  });

  it("is symmetric", () => {
    expect(amountsClose(100, 104)).toBe(amountsClose(104, 100));
  });
});

describe("clusterAmounts", () => {
  it("returns an empty array for empty input", () => {
    expect(clusterAmounts([])).toEqual([]);
  });

  it("returns one cluster for a tight group", () => {
    expect(clusterAmounts([-12, -12, -11.99, -12.01])).toEqual([[0, 3]]);
  });

  it("splits at gaps wider than tolerance", () => {
    // Two distinct subscriptions: ~12 EUR and ~25 EUR
    expect(clusterAmounts([-25, -25, -12, -12])).toEqual([
      [0, 1], // -25 cluster
      [2, 3], // -12 cluster
    ]);
  });

  it("handles single-element input", () => {
    expect(clusterAmounts([-100])).toEqual([[0, 0]]);
  });

  it("clusters Netflix 11.99 / 12.00 / 12.99 (gradual price hikes)", () => {
    // Each pair within tolerance, the whole chain is one cluster
    const result = clusterAmounts([-11.99, -12.0, -12.99]);
    expect(result).toEqual([[0, 2]]);
  });
});

describe("classifyCadence", () => {
  it("classifies typical cadences", () => {
    expect(classifyCadence(7)).toBe("weekly");
    expect(classifyCadence(14)).toBe("biweekly");
    expect(classifyCadence(30)).toBe("monthly");
    expect(classifyCadence(31)).toBe("monthly");
    expect(classifyCadence(90)).toBe("quarterly");
    expect(classifyCadence(365)).toBe("yearly");
  });

  it("returns irregular for off-cadence intervals", () => {
    expect(classifyCadence(45)).toBe("irregular");
    expect(classifyCadence(200)).toBe("irregular");
    expect(classifyCadence(2)).toBe("irregular");
  });

  it("tolerates ±2 day jitter on monthly", () => {
    expect(classifyCadence(28)).toBe("monthly");
    expect(classifyCadence(33)).toBe("monthly");
  });
});

describe("daysBetween", () => {
  it("computes positive differences for chronological dates", () => {
    expect(daysBetween("2026-01-01", "2026-01-08")).toBe(7);
    expect(daysBetween("2026-01-01", "2026-02-01")).toBe(31);
  });

  it("handles year boundary", () => {
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
  });

  it("returns negative for reversed dates", () => {
    expect(daysBetween("2026-02-01", "2026-01-01")).toBe(-31);
  });
});
