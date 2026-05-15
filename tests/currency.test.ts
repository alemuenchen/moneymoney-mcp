import { describe, it, expect } from "vitest";
import { sumByCurrency } from "../src/lib/currency.js";

describe("sumByCurrency", () => {
  it("returns an empty array for empty input", () => {
    expect(sumByCurrency([])).toEqual([]);
  });

  it("aggregates a single currency into one entry", () => {
    const result = sumByCurrency([
      { amount: -10, currency: "EUR" },
      { amount: -5, currency: "EUR" },
      { amount: 20, currency: "EUR" },
    ]);
    expect(result).toEqual([{ currency: "EUR", totalAmount: 5, count: 3 }]);
  });

  it("never sums amounts across currencies", () => {
    const result = sumByCurrency([
      { amount: 1000, currency: "EUR" },
      { amount: 200, currency: "USD" },
    ]);
    expect(result).toHaveLength(2);
    const eur = result.find((r) => r.currency === "EUR");
    const usd = result.find((r) => r.currency === "USD");
    expect(eur).toEqual({ currency: "EUR", totalAmount: 1000, count: 1 });
    expect(usd).toEqual({ currency: "USD", totalAmount: 200, count: 1 });
  });

  it("sorts entries by descending absolute total", () => {
    const result = sumByCurrency([
      { amount: 50, currency: "EUR" },
      { amount: -900, currency: "USD" },
      { amount: 300, currency: "GBP" },
    ]);
    expect(result.map((r) => r.currency)).toEqual(["USD", "GBP", "EUR"]);
  });

  it("treats an empty currency string as EUR", () => {
    const result = sumByCurrency([
      { amount: 10, currency: "" },
      { amount: 5, currency: "EUR" },
    ]);
    expect(result).toEqual([{ currency: "EUR", totalAmount: 15, count: 2 }]);
  });
});
