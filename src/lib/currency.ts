// Currency-aware aggregation.
//
// MoneyMoney accounts can hold transactions in more than one currency. Summing
// raw `amount` values across currencies produces a meaningless figure (e.g.
// "1200" that is really 1000 EUR + 200 USD). Every monetary aggregation in
// this connector goes through `sumByCurrency` so totals stay per-currency.

export interface CurrencyTotal {
  currency: string;
  totalAmount: number;
  count: number;
}

/**
 * Aggregates transaction amounts grouped by currency. Returns one entry per
 * distinct currency, sorted by descending absolute total. Amounts are never
 * summed across currencies.
 */
export function sumByCurrency(
  transactions: Array<{ amount: number; currency: string }>,
): CurrencyTotal[] {
  const byCurrency = new Map<string, CurrencyTotal>();
  for (const t of transactions) {
    const currency = t.currency || "EUR";
    const entry = byCurrency.get(currency);
    if (entry) {
      entry.totalAmount += t.amount;
      entry.count += 1;
    } else {
      byCurrency.set(currency, { currency, totalAmount: t.amount, count: 1 });
    }
  }
  return [...byCurrency.values()].sort(
    (a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount),
  );
}
