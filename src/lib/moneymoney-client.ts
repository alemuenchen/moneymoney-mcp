import {
  getAccounts,
  getCategories,
  checkDatabaseUnlocked,
  DatabaseLockedError,
  MoneyMoneyError,
} from "moneymoney";
import type { Account, Transaction, Category } from "moneymoney";
import plist from "plist";
import type {
  AccountResponse,
  TransactionResponse,
  CategoryResponse,
  PortfolioResponse,
  SecurityResponse,
} from "./types.js";
import { runAppleScript, escapeAppleScriptString, AppleScriptError } from "./applescript.js";
import { logger } from "./logger.js";
import {
  getAccountHierarchy,
  getCategoryHierarchy,
  deriveAccountClosure,
  resolveAccountUuids,
  categoryPathStartsWith,
  invalidateHierarchyCache,
  type AccountHierarchy,
  type CategoryHierarchy,
} from "./hierarchy.js";
import { parseISODate, toISODate, InvalidDateError } from "./dates.js";
import { sumByCurrency, type CurrencyTotal } from "./currency.js";

export { invalidateHierarchyCache, InvalidDateError };
export type { CurrencyTotal };

// ---------------------------------------------------------------------------
// Lock check with TTL cache (Bug 3)
//
// Every read/write tool used to call `checkDatabaseUnlocked()` upstream, which
// is itself an osascript round-trip (50–200ms). For multi-tool conversations
// this adds up. We cache the unlocked flag for `UNLOCK_TTL_MS`. If a tool
// fails because the DB became locked between checks, the upstream library
// throws DatabaseLockedError and we invalidate the cache.
// ---------------------------------------------------------------------------

const UNLOCK_TTL_MS = 30_000;
let unlockedUntil = 0;

export function invalidateUnlockCache(): void {
  unlockedUntil = 0;
}

export async function ensureUnlocked(): Promise<void> {
  if (Date.now() < unlockedUntil) return;
  const unlocked = await checkDatabaseUnlocked();
  if (!unlocked) {
    // DatabaseLockedError's constructor takes no arguments and provides
    // its own canonical message ("The MoneyMoney database is locked..."),
    // which is fine — we add a hint at the tool layer.
    throw new DatabaseLockedError();
  }
  unlockedUntil = Date.now() + UNLOCK_TTL_MS;
}

// ---------------------------------------------------------------------------
// AppleScript bridge (used only for what the npm library doesn't expose:
// portfolio export and a few queries used by new tools).
// ---------------------------------------------------------------------------

async function tellMoneyMoney<T>(
  command: string,
  options?: { timeoutMs?: number; maxBuffer?: number },
): Promise<T> {
  const script = `tell application "MoneyMoney"\n${command}\nend tell`;
  logger.debug("tellMoneyMoney", { commandPreview: command.slice(0, 80) });
  let stdout: string;
  try {
    stdout = await runAppleScript(script, options);
  } catch (err) {
    // MoneyMoney surfaces a locked database as an AppleScript error. Map it to
    // DatabaseLockedError so the tool layer classifies it as database_locked
    // and invalidates the unlock cache. Without this, a database that locks
    // after the unlock-cache check (TTL still valid) would surface as a
    // generic applescript_error and the stale cache would keep skipping the
    // real lock check on retries. Upstream getTransactions did this mapping;
    // our local export path (and the portfolio path) must do it too.
    if (
      err instanceof AppleScriptError &&
      (err.message.includes("Locked database") || err.stderr.includes("Locked database"))
    ) {
      throw new DatabaseLockedError();
    }
    throw err;
  }
  if (!stdout) return undefined as T;
  try {
    return plist.parse(stdout) as T;
  } catch (err) {
    throw new AppleScriptError(
      `MoneyMoney returned non-plist output: ${(err as Error).message}`,
      stdout.slice(0, 500),
      0,
    );
  }
}

// Safe finite-number formatter for AppleScript numeric literals. AppleScript
// accepts decimal notation but not Infinity/NaN; we reject both to avoid
// emitting a literal that osascript would parse incorrectly.
function formatNumberForAppleScript(value: number, field: string): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${field}: must be a finite number, got ${value}.`);
  }
  return String(value);
}

// Build a single optional clause "<keyword> <value>" or empty if value is
// undefined/null/empty. String values are escaped via escapeAppleScriptString;
// numbers are validated for finiteness; dates are formatted as YYYY-MM-DD.
function clause(keyword: string, value: string | number | Date | undefined | null, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") {
    if (value === "") return "";
    return `${keyword} ${escapeAppleScriptString(value)}`;
  }
  if (typeof value === "number") {
    return `${keyword} ${formatNumberForAppleScript(value, field)}`;
  }
  if (value instanceof Date) {
    return `${keyword} ${escapeAppleScriptString(toISODate(value))}`;
  }
  throw new Error(`Unsupported value type for ${field}.`);
}

// Pure script builders. Exported for unit tests that verify the produced
// AppleScript is injection-safe. The runtime wrappers just feed the result
// to tellMoneyMoney.
//
// Why local instead of the upstream `addTransaction`/`createBankTransfer`:
// upstream interpolates string parameters via `'"' + value + '"'` with no
// escaping (see node_modules/moneymoney/dist/utils.js:formatAppleScript),
// which is an AppleScript injection surface.
export function buildAddTransactionScript(opts: {
  account: string;
  amount: number;
  to: string;
  date: Date;
  purpose?: string;
  category?: string;
}): string {
  const lines = [
    "add transaction",
    `  ${clause("to account", opts.account, "account")}`,
    `  ${clause("on date", opts.date, "date")}`,
    `  ${clause("to", opts.to, "to")}`,
    `  ${clause("amount", opts.amount, "amount")}`,
    `  ${clause("purpose", opts.purpose, "purpose")}`,
    `  ${clause("category", opts.category, "category")}`,
  ].filter((l) => l.trim() !== "");
  return lines.join("\n");
}

// Opens a pre-filled payment window in MoneyMoney; the user must still
// confirm. We deliberately do NOT support `into "outbox"` here because
// silently saving a transfer without UI confirmation raises the blast
// radius if anything goes wrong upstream.
export function buildCreateBankTransferScript(opts: {
  fromAccount: string;
  to: string;
  iban: string;
  amount: number;
  purpose?: string;
}): string {
  const lines = [
    "create bank transfer",
    `  ${clause("from account", opts.fromAccount, "fromAccount")}`,
    `  ${clause("to", opts.to, "to")}`,
    `  ${clause("iban", opts.iban, "iban")}`,
    `  ${clause("amount", opts.amount, "amount")}`,
    `  ${clause("purpose", opts.purpose, "purpose")}`,
  ].filter((l) => l.trim() !== "");
  return lines.join("\n");
}

async function addTransactionSafe(opts: Parameters<typeof buildAddTransactionScript>[0]): Promise<void> {
  await tellMoneyMoney<void>(buildAddTransactionScript(opts));
}

async function createBankTransferSafe(opts: Parameters<typeof buildCreateBankTransferScript>[0]): Promise<void> {
  await tellMoneyMoney<void>(buildCreateBankTransferScript(opts));
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapAccount(a: Account, hierarchy: AccountHierarchy): AccountResponse {
  const closure = deriveAccountClosure(a.uuid, hierarchy);
  return {
    name: a.name,
    accountNumber: a.accountNumber,
    bankCode: a.bankCode,
    balance: a.balance.map(([amount, currency]) => ({ amount, currency })),
    currency: a.currency,
    type: a.type,
    owner: a.owner,
    portfolio: a.portfolio,
    group: a.group,
    uuid: a.uuid,
    indentation: a.indentation,
    parentGroupName: closure.parentGroupName,
    parentPath: closure.parentPath,
    isClosed: closure.isClosed,
  };
}

function mapTransaction(t: Transaction): TransactionResponse {
  return {
    id: t.id,
    bookingDate: toISODate(t.bookingDate),
    valueDate: toISODate(t.valueDate),
    name: t.name,
    purpose: t.purpose,
    amount: t.amount,
    currency: t.currency,
    booked: t.booked,
    checkmark: t.checkmark,
    comment: t.comment,
    bookingText: t.bookingText,
    accountUuid: t.accountUuid,
    categoryUuid: t.categoryUuid,
  };
}

function enrichTransactionWithCategory(
  t: TransactionResponse,
  hierarchy: CategoryHierarchy,
): TransactionResponse {
  const node = hierarchy.tree.get(t.categoryUuid);
  if (!node) return t;
  return {
    ...t,
    categoryName: node.item.name,
    categoryPath: node.path,
    categoryRoot: node.rootName,
  };
}

function mapCategory(c: Category, hierarchy: CategoryHierarchy): CategoryResponse {
  const node = hierarchy.tree.get(c.uuid);
  const result: CategoryResponse = {
    name: c.name,
    uuid: c.uuid,
    currency: c.currency,
    group: c.group,
    indentation: c.indentation,
    default: c.default,
    parentUuid: node?.parentUuid ?? null,
    path: node?.path ?? c.name,
    rootName: node?.rootName ?? c.name,
  };
  if (!c.default && c.budget && "amount" in c.budget) {
    result.budget = {
      amount: c.budget.amount,
      available: c.budget.available,
      period: c.budget.period,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------

export async function listAccounts(opts: { includeClosed?: boolean } = {}): Promise<AccountResponse[]> {
  await ensureUnlocked();
  const hierarchy = await getAccountHierarchy(getAccounts);
  const enriched = hierarchy.list.map((a) => mapAccount(a, hierarchy));
  if (opts.includeClosed) return enriched;
  return enriched.filter((a) => !a.isClosed);
}

/** Find a single account by exact name. Used for pre-flight checks.
 *  This always considers BOTH open and closed accounts, since a caller asking
 *  by name is usually interested in matching whatever's there. */
export async function getAccountByName(name: string): Promise<AccountResponse | null> {
  const accounts = await listAccounts({ includeClosed: true });
  return accounts.find((a) => a.name === name) ?? null;
}

/** Get only one account's balance — avoids returning the full account list when
 *  the caller already knows which account it wants. */
export async function getAccountBalance(name: string): Promise<{ name: string; balance: { amount: number; currency: string }[]; type: string; isClosed: boolean } | null> {
  const acc = await getAccountByName(name);
  if (!acc) return null;
  return { name: acc.name, balance: acc.balance, type: acc.type, isClosed: acc.isClosed };
}

/** Bug 3 fix: bypass the upstream `forAccount` option (which generates broken
 *  AppleScript — the dictionary expects `from account` but the lib emits
 *  `for account`, causing "Unknown error" on every call).
 *
 *  Strategy: fetch transactions for the date range with no account filter at
 *  all (the upstream lib drops the clause when `forAccount` is undefined),
 *  then filter client-side on `accountUuid`. This also lets us support
 *  account-group names — passing a group name like "Personal" expands to
 *  all leaf accounts inside that group. */
async function _fetchAndFilterTransactions(opts: {
  from: string;
  to?: string;
  accountName?: string;
  includeClosed?: boolean;
}): Promise<TransactionResponse[]> {
  await ensureUnlocked();
  const from = parseISODate(opts.from, "from_date");
  const to = opts.to ? parseISODate(opts.to, "to_date") : undefined;
  if (to && to < from) {
    throw new Error(`to_date (${opts.to}) is before from_date (${opts.from}).`);
  }

  // Export the full date window ourselves instead of via upstream
  // `getTransactions`: upstream's runAppleScript caps stdout at 5 MB, so any
  // window wider than ~1 year (where the full-DB plist crosses 5 MB) fails
  // with a generic "Unknown error". Our own tellMoneyMoney/runAppleScript uses
  // a 50 MB buffer and a temp-file invocation, so it handles the whole
  // catalogue in a single call. We still fetch the full window and filter by
  // account/category in JS — upstream's `for account` clause is broken on
  // current MoneyMoney versions.
  const exportCommand =
    `export transactions ${clause("from date", from, "from_date")} ` +
    `${clause("to date", to, "to_date")} as "plist"`;
  // Generous timeout: a multi-year/full-catalogue export can take longer than
  // runAppleScript's 30s default. Upstream getTransactions set no timeout at
  // all; 120s keeps a bound (so a genuinely hung osascript can't hang forever)
  // while comfortably covering large exports. The 50 MB stdout buffer is the
  // real size guard.
  const exportResult = await tellMoneyMoney<{ transactions?: Transaction[] }>(
    exportCommand,
    { timeoutMs: 120_000 },
  );
  const transactions = exportResult?.transactions ?? [];

  const accountHierarchy = await getAccountHierarchy(getAccounts);
  let allowedUuids: Set<string> | null = null;

  if (opts.accountName !== undefined) {
    const resolved = resolveAccountUuids(opts.accountName, accountHierarchy);
    if (resolved.uuids.length === 0) {
      // Surface a more actionable error than upstream's "Unknown error".
      const candidates = accountHierarchy.list
        .map((a) => a.name)
        .filter((n) => n.toLowerCase().includes(opts.accountName!.toLowerCase()))
        .slice(0, 5);
      const hint = candidates.length
        ? ` Did you mean: ${candidates.map((n) => JSON.stringify(n)).join(", ")}?`
        : " Use list_accounts to see exact names.";
      throw new Error(`Account "${opts.accountName}" not found.${hint}`);
    }
    allowedUuids = new Set(resolved.uuids);
  }

  // Closed-account filter: by default exclude transactions whose accountUuid
  // belongs to an account flagged isClosed via parent-group inference.
  if (!opts.includeClosed) {
    const closedUuids = new Set<string>();
    for (const a of accountHierarchy.list) {
      if (a.group) continue;
      const closure = deriveAccountClosure(a.uuid, accountHierarchy);
      if (closure.isClosed) closedUuids.add(a.uuid);
    }
    if (allowedUuids) {
      // Caller explicitly asked for an account; if THAT specific account is
      // closed, honour the request (they explicitly named it). But if the
      // caller asked for a group, drop closed accounts inside it.
      const allowedActive = new Set([...allowedUuids].filter((u) => !closedUuids.has(u)));
      if (allowedActive.size > 0 || allowedUuids.size === 1) {
        // single explicit account → keep it even if closed
        if (allowedUuids.size > 1) allowedUuids = allowedActive;
      }
    } else {
      // No explicit account: drop transactions whose accountUuid is closed.
      allowedUuids = new Set(
        accountHierarchy.list
          .filter((a) => !a.group && !closedUuids.has(a.uuid))
          .map((a) => a.uuid),
      );
    }
  }

  const mapped = transactions.map(mapTransaction);
  return allowedUuids ? mapped.filter((t) => allowedUuids!.has(t.accountUuid)) : mapped;
}

export async function fetchTransactions(opts: {
  from: string;
  to?: string;
  accountName?: string;
  includeClosed?: boolean;
  resolveCategory?: boolean;
}): Promise<TransactionResponse[]> {
  const tx = await _fetchAndFilterTransactions(opts);
  if (opts.resolveCategory) {
    const categoryHierarchy = await getCategoryHierarchy(getCategories);
    return tx.map((t) => enrichTransactionWithCategory(t, categoryHierarchy));
  }
  return tx;
}

export interface SearchTransactionsOptions {
  from: string;
  to?: string;
  accountName?: string;
  /** Substring match (case-insensitive) on counterparty `name`. */
  nameContains?: string;
  /** Substring match (case-insensitive) on `purpose`. */
  purposeContains?: string;
  /** Inclusive minimum signed amount. Negatives are expenses. */
  minAmount?: number;
  /** Inclusive maximum signed amount. */
  maxAmount?: number;
  /** Filter by exact category UUID. */
  categoryUuid?: string;
  /** Filter by category-tree subtree. e.g. "Business" matches every category
   *  whose path starts with "Business". Segment-aware: "Per" does NOT
   *  match "Personal". Case-insensitive. */
  categoryPathPrefix?: string;
  /** Include transactions on closed-archive accounts. Default false. */
  includeClosed?: boolean;
  /** When true, each returned transaction includes categoryName/Path/Root. */
  resolveCategory?: boolean;
  /** Limit number of returned transactions (default 500). */
  limit?: number;
}

export async function searchTransactions(opts: SearchTransactionsOptions): Promise<TransactionResponse[]> {
  const all = await _fetchAndFilterTransactions({
    from: opts.from,
    to: opts.to,
    accountName: opts.accountName,
    includeClosed: opts.includeClosed,
  });
  const nameNeedle = opts.nameContains?.toLowerCase();
  const purposeNeedle = opts.purposeContains?.toLowerCase();
  const limit = opts.limit ?? 500;

  const categoryHierarchy = (opts.categoryPathPrefix || opts.resolveCategory)
    ? await getCategoryHierarchy(getCategories)
    : null;

  const filtered: TransactionResponse[] = [];
  for (const t of all) {
    if (nameNeedle && !t.name.toLowerCase().includes(nameNeedle)) continue;
    if (purposeNeedle && !(t.purpose ?? "").toLowerCase().includes(purposeNeedle)) continue;
    if (opts.minAmount !== undefined && t.amount < opts.minAmount) continue;
    if (opts.maxAmount !== undefined && t.amount > opts.maxAmount) continue;
    if (opts.categoryUuid && t.categoryUuid !== opts.categoryUuid) continue;
    if (opts.categoryPathPrefix && categoryHierarchy) {
      if (!categoryPathStartsWith(t.categoryUuid, opts.categoryPathPrefix, categoryHierarchy)) continue;
    }
    let row = t;
    if (opts.resolveCategory && categoryHierarchy) {
      row = enrichTransactionWithCategory(t, categoryHierarchy);
    }
    filtered.push(row);
    if (filtered.length >= limit) break;
  }
  return filtered;
}

export interface CategoryTotal {
  categoryUuid?: string;
  categoryName?: string;
  categoryPath?: string;
  pathPrefix?: string;
  from: string;
  to: string;
  count: number;
  /** Per-currency totals. Always present. Amounts are never summed across
   *  currencies — a category with both EUR and USD transactions yields two
   *  entries. */
  totalsByCurrency: CurrencyTotal[];
  /** Convenience scalar, present ONLY when every matching transaction shares
   *  one currency. Absent for mixed-currency results — read totalsByCurrency
   *  instead. */
  totalAmount?: number;
  /** Currency of `totalAmount`. Present under the same single-currency
   *  condition. */
  currency?: string;
}

export async function getCategoryTotal(opts: {
  categoryUuid?: string;
  categoryPathPrefix?: string;
  from: string;
  to?: string;
  accountName?: string;
  includeClosed?: boolean;
}): Promise<CategoryTotal> {
  if (!opts.categoryUuid && !opts.categoryPathPrefix) {
    throw new Error("getCategoryTotal: provide either categoryUuid or categoryPathPrefix.");
  }
  const transactions = await _fetchAndFilterTransactions({
    from: opts.from,
    to: opts.to,
    accountName: opts.accountName,
    includeClosed: opts.includeClosed,
  });
  const categoryHierarchy = await getCategoryHierarchy(getCategories);

  const matching = transactions.filter((t) => {
    if (opts.categoryUuid && t.categoryUuid !== opts.categoryUuid) return false;
    if (opts.categoryPathPrefix && !categoryPathStartsWith(t.categoryUuid, opts.categoryPathPrefix, categoryHierarchy)) return false;
    return true;
  });
  const totalsByCurrency = sumByCurrency(matching);
  const single = totalsByCurrency.length === 1 ? totalsByCurrency[0] : undefined;

  let categoryName: string | undefined;
  let categoryPath: string | undefined;
  if (opts.categoryUuid) {
    const node = categoryHierarchy.tree.get(opts.categoryUuid);
    categoryName = node?.item.name;
    categoryPath = node?.path;
  }

  return {
    categoryUuid: opts.categoryUuid,
    categoryName,
    categoryPath,
    pathPrefix: opts.categoryPathPrefix,
    from: opts.from,
    to: opts.to ?? toISODate(new Date()),
    count: matching.length,
    totalsByCurrency,
    totalAmount: single?.totalAmount,
    currency: single?.currency,
  };
}

export async function listCategories(): Promise<CategoryResponse[]> {
  await ensureUnlocked();
  const hierarchy = await getCategoryHierarchy(getCategories);
  return hierarchy.list.map((c) => mapCategory(c, hierarchy));
}

export async function fetchPortfolio(accountName?: string): Promise<PortfolioResponse> {
  await ensureUnlocked();
  // The npm package doesn't expose portfolio export, so we use AppleScript
  // directly. Account name is properly escaped (Bug 1 fix).
  let command = 'export portfolio as "plist"';
  if (accountName) {
    command = `export portfolio from account ${escapeAppleScriptString(accountName)} as "plist"`;
  }

  const result = await tellMoneyMoney<unknown>(command);

  let items: Record<string, unknown>[];
  if (Array.isArray(result)) {
    items = result;
  } else if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    items = Array.isArray(obj.portfolio) ? (obj.portfolio as Record<string, unknown>[]) : [];
  } else {
    items = [];
  }

  const securities: SecurityResponse[] = items.map((s: Record<string, unknown>) => ({
    name: (s.name as string) ?? "",
    isin: (s.isin as string) ?? "",
    securityNumber: (s.securityNumber as string) ?? "",
    type: (s.type as string) ?? "",
    assetClass: (s.assetClass as string) ?? "",
    market: (s.market as string) ?? "",
    quantity: (s.quantity as number) ?? 0,
    price: (s.price as number) ?? 0,
    currencyOfPrice: (s.currencyOfPrice as string) ?? "",
    amount: (s.amount as number) ?? 0,
    currencyOfAmount: (s.currencyOfAmount as string) ?? "",
    purchasePrice: (s.purchasePrice as number) ?? 0,
    currencyOfPurchasePrice: (s.currencyOfPurchasePrice as string) ?? "",
    absoluteProfit: (s.absoluteProfit as number) ?? 0,
    relativeProfit: (s.relativeProfit as number) ?? 0,
    currencyOfProfit: (s.currencyOfProfit as string) ?? "",
    tradeTimestamp: (s.tradeTimestamp as string) ?? "",
  }));

  return { accountName, securities };
}

// ---------------------------------------------------------------------------
// Write API
// ---------------------------------------------------------------------------

/** Account types that accept manual transactions in MoneyMoney.
 *  Online banking accounts reject `add transaction`. We pre-flight to give a
 *  better error than the upstream library's opaque message. */
const OFFLINE_ACCOUNT_TYPES = new Set([
  "Manuell",
  "Manual",
  "Verrechnungskonto",
  "Andere",
  "Other",
  "Bargeld",
  "Cash",
  "Portfolio",
]);

function looksLikeOfflineAccount(type: string): boolean {
  // Heuristic: MoneyMoney's account types are localized (DE / EN / IT). We
  // accept the explicit set above; if the type is unrecognised we let the
  // upstream library decide and surface its error instead of blocking.
  return OFFLINE_ACCOUNT_TYPES.has(type);
}

export async function createTransaction(opts: {
  accountName: string;
  amount: number;
  purpose: string;
  name: string;
  bookingDate?: string;
  categoryId?: string;
}): Promise<{ categoryApplied: boolean; warning?: string }> {
  await ensureUnlocked();

  // Bug 7: pre-flight account type check.
  const account = await getAccountByName(opts.accountName);
  if (!account) {
    throw new Error(
      `Account "${opts.accountName}" not found. Use moneymoney_list_accounts to see available accounts.`,
    );
  }
  if (!looksLikeOfflineAccount(account.type)) {
    logger.warn("addTransaction on possibly-online account", { account: opts.accountName, type: account.type });
    // We don't hard-block: account type strings are localized and our list may
    // be incomplete. We just record a warning.
  }

  // Bug 4: validate booking_date format if supplied.
  const bookingDate = opts.bookingDate ? parseISODate(opts.bookingDate, "booking_date") : new Date();

  await addTransactionSafe({
    account: opts.accountName,
    amount: opts.amount,
    to: opts.name,
    date: bookingDate,
    purpose: opts.purpose,
    category: opts.categoryId,
  });

  // Bug 5: post-flight verify category was applied. We fetch the booking-day
  // window via the patched _fetchAndFilterTransactions (account filter applied
  // locally because upstream `forAccount` is broken on current MoneyMoney).
  if (opts.categoryId) {
    const dayISO = toISODate(bookingDate);
    try {
      const recent = await _fetchAndFilterTransactions({
        from: dayISO,
        to: dayISO,
        accountName: opts.accountName,
        includeClosed: true,
      });
      const created = recent
        .reverse()
        .find((t) => t.amount === opts.amount && t.name === opts.name && (t.purpose ?? "") === opts.purpose);
      if (created && !created.categoryUuid) {
        return {
          categoryApplied: false,
          warning: `Transaction created but category "${opts.categoryId}" was not applied. Verify the category UUID/path is correct.`,
        };
      }
      if (!created) {
        // We couldn't locate the just-created transaction (possible race or
        // exact-match miss). Don't claim success.
        return {
          categoryApplied: false,
          warning: `Transaction created but post-flight verification could not locate it; category "${opts.categoryId}" application is unconfirmed.`,
        };
      }
      return { categoryApplied: true };
    } catch (err) {
      logger.warn("post-flight category check failed", { error: (err as Error).message });
      return {
        categoryApplied: false,
        warning: `Transaction created but post-flight check failed (${(err as Error).message}); category application is unconfirmed.`,
      };
    }
  }
  return { categoryApplied: true };
}

export async function initiateBankTransfer(opts: {
  fromAccount: string;
  toName: string;
  toIban: string;
  amount: number;
  purpose: string;
}): Promise<void> {
  await ensureUnlocked();
  await createBankTransferSafe({
    fromAccount: opts.fromAccount,
    to: opts.toName,
    iban: opts.toIban,
    amount: opts.amount,
    purpose: opts.purpose,
  });
}

// ---------------------------------------------------------------------------
// Error type guards
// ---------------------------------------------------------------------------

export function isMoneyMoneyError(err: unknown): err is MoneyMoneyError {
  return err instanceof MoneyMoneyError;
}

export function isDatabaseLockedError(err: unknown): err is DatabaseLockedError {
  return err instanceof DatabaseLockedError;
}

export function isAppleScriptError(err: unknown): err is AppleScriptError {
  return err instanceof AppleScriptError;
}

export function isInvalidDateError(err: unknown): err is InvalidDateError {
  return err instanceof InvalidDateError;
}

export { AppleScriptError, DatabaseLockedError, MoneyMoneyError };
