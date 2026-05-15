// Financial analytics helpers built on top of the transaction read API.
//
// All three operations are pure aggregations: they pull transactions via the
// existing fetchTransactions / searchTransactions paths and then bucket /
// group / sort in memory. No new I/O paths, no new error surfaces.

import { fetchTransactions, listCategories } from "./moneymoney-client.js";
import { getCategoryHierarchy, categoryPathStartsWith } from "./hierarchy.js";
import { getCategories } from "moneymoney";
import type { TransactionResponse } from "./types.js";
import { toISODate, daysBetween } from "./dates.js";

interface CommonAnalyticsOpts {
  /** Include archive accounts (default false). */
  includeClosed?: boolean;
  /** Filter to one branch of the category tree, e.g. "Business" or
   *  "Travel > Flights". Segment-aware: "Per" does NOT match "Personal". */
  categoryPathPrefix?: string;
}

async function _filterByCategoryPath(
  transactions: TransactionResponse[],
  categoryPathPrefix: string | undefined,
): Promise<TransactionResponse[]> {
  if (!categoryPathPrefix) return transactions;
  const hierarchy = await getCategoryHierarchy(getCategories);
  return transactions.filter((t) =>
    categoryPathStartsWith(t.categoryUuid, categoryPathPrefix, hierarchy),
  );
}

// ---------------------------------------------------------------------------
// Common helpers
// ---------------------------------------------------------------------------

// Test if two amounts are within tolerance — relative 5% with absolute floor 1.0.
// Used for clustering recurring transactions where small variations (tax,
// exchange rate, rounding) shouldn't split an otherwise stable subscription.
function amountsClose(a: number, b: number): boolean {
  const tolerance = Math.max(Math.max(Math.abs(a), Math.abs(b)) * 0.05, 1.0);
  return Math.abs(a - b) <= tolerance;
}

// Cluster a sorted list of amounts into groups where neighboring elements are
// within tolerance. Returns array of index ranges into the sorted array.
function clusterAmounts(sortedAmounts: number[]): Array<[number, number]> {
  if (sortedAmounts.length === 0) return [];
  const ranges: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i < sortedAmounts.length; i++) {
    if (!amountsClose(sortedAmounts[i - 1]!, sortedAmounts[i]!)) {
      ranges.push([start, i - 1]);
      start = i;
    }
  }
  ranges.push([start, sortedAmounts.length - 1]);
  return ranges;
}

function normalizeName(name: string): string {
  // Strip trailing booking codes / dates that vary across transactions of the
  // same vendor: "AMZN MKTP DE 5478291", "AMZN MKTP DE 9981212". We keep the
  // first ~40 chars and uppercase, dropping numeric tails.
  return name
    .toUpperCase()
    .replace(/\s+\d{4,}\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
}

// ---------------------------------------------------------------------------
// 1. Recurring transactions
// ---------------------------------------------------------------------------

export interface RecurringTransaction {
  name: string;
  /** Representative amount (median across occurrences). */
  amount: number;
  currency: string;
  count: number;
  totalAmount: number;
  /** Estimated cadence: weekly / biweekly / monthly / quarterly / yearly / irregular. */
  cadence: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "irregular";
  meanIntervalDays: number;
  firstSeen: string;
  lastSeen: string;
  sampleCategoryUuid?: string;
}

function classifyCadence(meanDays: number): RecurringTransaction["cadence"] {
  if (meanDays >= 5 && meanDays <= 9) return "weekly";
  if (meanDays >= 12 && meanDays <= 16) return "biweekly";
  if (meanDays >= 25 && meanDays <= 35) return "monthly";
  if (meanDays >= 80 && meanDays <= 100) return "quarterly";
  if (meanDays >= 350 && meanDays <= 380) return "yearly";
  return "irregular";
}

export async function getRecurringTransactions(opts: {
  from: string;
  to?: string;
  accountName?: string;
  /** Minimum occurrences for a pattern to be reported. Default 2. */
  minOccurrences?: number;
} & CommonAnalyticsOpts): Promise<RecurringTransaction[]> {
  const minOccurrences = opts.minOccurrences ?? 2;
  const raw = await fetchTransactions({
    from: opts.from,
    to: opts.to,
    accountName: opts.accountName,
    includeClosed: opts.includeClosed,
  });
  const transactions = await _filterByCategoryPath(raw, opts.categoryPathPrefix);

  // First-pass: group by normalized name + currency.
  const byName = new Map<string, TransactionResponse[]>();
  for (const t of transactions) {
    const key = `${normalizeName(t.name)}|${t.currency}`;
    const arr = byName.get(key);
    if (arr) arr.push(t);
    else byName.set(key, [t]);
  }

  // Second-pass: cluster each name group by amount (1D clustering).
  // This is more robust than fixed bucketing — neighboring amounts in the
  // sorted list join the same cluster if they're within tolerance, regardless
  // of where the "bucket boundary" would have fallen.
  const groups: TransactionResponse[][] = [];
  for (const txs of byName.values()) {
    if (txs.length === 0) continue;
    const sorted = [...txs].sort((a, b) => a.amount - b.amount);
    const ranges = clusterAmounts(sorted.map((t) => t.amount));
    for (const [from, to] of ranges) {
      groups.push(sorted.slice(from, to + 1));
    }
  }

  const recurring: RecurringTransaction[] = [];
  for (const group of groups) {
    if (group.length < minOccurrences) continue;
    // Sort by booking date ascending
    group.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));

    const intervals: number[] = [];
    for (let i = 1; i < group.length; i++) {
      intervals.push(daysBetween(group[i - 1]!.bookingDate, group[i]!.bookingDate));
    }
    const meanIntervalDays =
      intervals.length > 0
        ? intervals.reduce((s, x) => s + x, 0) / intervals.length
        : 0;

    // Median amount as representative
    const sorted = [...group].sort((a, b) => a.amount - b.amount);
    const median = sorted[Math.floor(sorted.length / 2)]!.amount;

    recurring.push({
      name: group[0]!.name,
      amount: median,
      currency: group[0]!.currency,
      count: group.length,
      totalAmount: group.reduce((s, t) => s + t.amount, 0),
      cadence: classifyCadence(meanIntervalDays),
      meanIntervalDays: Math.round(meanIntervalDays),
      firstSeen: group[0]!.bookingDate,
      lastSeen: group[group.length - 1]!.bookingDate,
      sampleCategoryUuid: group[0]!.categoryUuid || undefined,
    });
  }

  // Sort by absolute total descending — the most impactful recurring items first.
  recurring.sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount));
  return recurring;
}

// ---------------------------------------------------------------------------
// 2. Top counterparties
// ---------------------------------------------------------------------------

export interface CounterpartyAggregate {
  name: string;
  count: number;
  totalAmount: number;
  avgAmount: number;
  currency: string;
  firstSeen: string;
  lastSeen: string;
}

export async function getTopCounterparties(opts: {
  from: string;
  to?: string;
  accountName?: string;
  limit?: number;
  /** Filter by transaction direction. Default 'all'. */
  direction?: "expenses" | "income" | "all";
} & CommonAnalyticsOpts): Promise<CounterpartyAggregate[]> {
  const limit = opts.limit ?? 10;
  const direction = opts.direction ?? "all";
  const raw = await fetchTransactions({
    from: opts.from,
    to: opts.to,
    accountName: opts.accountName,
    includeClosed: opts.includeClosed,
  });
  const transactions = await _filterByCategoryPath(raw, opts.categoryPathPrefix);

  const filtered = transactions.filter((t) => {
    if (direction === "expenses") return t.amount < 0;
    if (direction === "income") return t.amount > 0;
    return true;
  });

  // Key includes currency so each aggregate stays single-currency — a
  // counterparty paid in both EUR and USD produces two separate rows
  // instead of one row with a meaningless mixed-currency total.
  const groups = new Map<string, TransactionResponse[]>();
  for (const t of filtered) {
    const key = `${normalizeName(t.name)}|${t.currency}`;
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }

  const aggregates: CounterpartyAggregate[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    const totalAmount = group.reduce((s, t) => s + t.amount, 0);
    aggregates.push({
      name: group[0]!.name,
      count: group.length,
      totalAmount,
      avgAmount: totalAmount / group.length,
      currency: group[0]!.currency,
      firstSeen: group[0]!.bookingDate,
      lastSeen: group[group.length - 1]!.bookingDate,
    });
  }

  // Sort by abs(totalAmount) desc — biggest impact first regardless of sign
  aggregates.sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount));
  return aggregates.slice(0, limit);
}

// ---------------------------------------------------------------------------
// 3. Compare two periods
// ---------------------------------------------------------------------------

export interface PeriodComparisonRow {
  key: string;
  /** Human-readable label (category name or counterparty name). */
  label: string;
  totalA: number;
  totalB: number;
  delta: number;
  /** Percentage change from A to B; undefined if A is zero. */
  deltaPct?: number;
  countA: number;
  countB: number;
  currency: string;
}

export interface PeriodComparisonSummary {
  currency: string;
  totalA: number;
  totalB: number;
  delta: number;
  countA: number;
  countB: number;
}

export interface PeriodComparison {
  periodA: { from: string; to: string };
  periodB: { from: string; to: string };
  groupBy: "category" | "counterparty";
  rows: PeriodComparisonRow[];
  /** Aggregate totals for quick reading, one entry per currency. Totals are
   *  never summed across currencies. */
  summaryByCurrency: PeriodComparisonSummary[];
}

async function aggregateForPeriod(
  from: string,
  to: string | undefined,
  accountName: string | undefined,
  groupBy: "category" | "counterparty",
  includeClosed: boolean | undefined,
  categoryPathPrefix: string | undefined,
  categoryNameLookup: Map<string, { name: string; path: string }> | null,
): Promise<Map<string, { label: string; total: number; count: number; currency: string }>> {
  const raw = await fetchTransactions({ from, to, accountName, includeClosed });
  const transactions = await _filterByCategoryPath(raw, categoryPathPrefix);
  const groups = new Map<string, { label: string; total: number; count: number; currency: string }>();
  for (const t of transactions) {
    let baseKey: string;
    let label: string;
    if (groupBy === "category") {
      const uuid = t.categoryUuid || "(uncategorized)";
      baseKey = uuid;
      const lookup = categoryNameLookup?.get(uuid);
      label = lookup?.path ?? uuid;
    } else {
      baseKey = normalizeName(t.name);
      label = t.name;
    }
    // Currency in the key keeps each bucket single-currency and still
    // matches like-for-like across the two periods.
    const key = `${baseKey}|${t.currency}`;
    const existing = groups.get(key);
    if (existing) {
      existing.total += t.amount;
      existing.count += 1;
    } else {
      groups.set(key, { label, total: t.amount, count: 1, currency: t.currency });
    }
  }
  return groups;
}

export async function comparePeriods(opts: {
  periodA: { from: string; to?: string };
  periodB: { from: string; to?: string };
  accountName?: string;
  groupBy?: "category" | "counterparty";
} & CommonAnalyticsOpts): Promise<PeriodComparison> {
  const groupBy = opts.groupBy ?? "category";
  const today = toISODate(new Date());
  const periodA = { from: opts.periodA.from, to: opts.periodA.to ?? today };
  const periodB = { from: opts.periodB.from, to: opts.periodB.to ?? today };

  // Pre-resolve category UUID → human path so `compare_periods(group_by=category)`
  // doesn't return raw UUIDs. This was a UX gap before — the docstring even
  // told the LLM to cross-reference manually with list_categories.
  let lookup: Map<string, { name: string; path: string }> | null = null;
  if (groupBy === "category") {
    const cats = await listCategories();
    lookup = new Map(cats.map((c) => [c.uuid, { name: c.name, path: c.path }]));
  }

  const aggA = await aggregateForPeriod(periodA.from, periodA.to, opts.accountName, groupBy, opts.includeClosed, opts.categoryPathPrefix, lookup);
  const aggB = await aggregateForPeriod(periodB.from, periodB.to, opts.accountName, groupBy, opts.includeClosed, opts.categoryPathPrefix, lookup);

  const allKeys = new Set<string>([...aggA.keys(), ...aggB.keys()]);
  const rows: PeriodComparisonRow[] = [];
  for (const key of allKeys) {
    const a = aggA.get(key);
    const b = aggB.get(key);
    const totalA = a?.total ?? 0;
    const totalB = b?.total ?? 0;
    const delta = totalB - totalA;
    const deltaPct =
      totalA !== 0 ? (delta / Math.abs(totalA)) * 100 : undefined;
    rows.push({
      key,
      label: a?.label ?? b?.label ?? key,
      totalA,
      totalB,
      delta,
      deltaPct: deltaPct !== undefined ? Math.round(deltaPct * 10) / 10 : undefined,
      countA: a?.count ?? 0,
      countB: b?.count ?? 0,
      currency: a?.currency ?? b?.currency ?? "EUR",
    });
  }

  // Sort by abs(delta) desc — biggest swings first
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  // Summary per currency — summing totalA/totalB across rows of different
  // currencies would produce a meaningless figure.
  const summaryMap = new Map<string, PeriodComparisonSummary>();
  for (const r of rows) {
    const s = summaryMap.get(r.currency);
    if (s) {
      s.totalA += r.totalA;
      s.totalB += r.totalB;
      s.countA += r.countA;
      s.countB += r.countB;
    } else {
      summaryMap.set(r.currency, {
        currency: r.currency,
        totalA: r.totalA,
        totalB: r.totalB,
        delta: 0,
        countA: r.countA,
        countB: r.countB,
      });
    }
  }
  const summaryByCurrency = [...summaryMap.values()];
  for (const s of summaryByCurrency) s.delta = s.totalB - s.totalA;
  summaryByCurrency.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { periodA, periodB, groupBy, rows, summaryByCurrency };
}

// Re-export internals only for tests
export const __test__ = { normalizeName, amountsClose, clusterAmounts, classifyCadence, daysBetween };
