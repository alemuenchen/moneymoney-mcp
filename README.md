# moneymoney-mcp

MCP server for the [MoneyMoney](https://moneymoney-app.com) macOS banking app.
Exposes accounts, categories, transactions, portfolio, and analytics tools to
LLM hosts via the Model Context Protocol.

Single-user, runs locally, AppleScript-only — no remote authentication, no
external services. The MoneyMoney app must be **running and unlocked** while
the connector is in use.

> **Platform:** macOS only. Requires Node.js ≥ 20 and a recent build of
> MoneyMoney (the AppleScript dictionary used here has been stable since
> MoneyMoney 2.4).

## Tools

13 tools, all prefixed `moneymoney_`. Read tools are always available; write
tools are gated by `MONEYMONEY_ENABLE_WRITES=true`.

### Accounts

- **`moneymoney_list_active_accounts`** — operational accounts only (default
  recommended starting point).
- **`moneymoney_list_accounts(include_closed?)`** — all accounts, including
  archived ones if `include_closed=true`.
- **`moneymoney_get_account_balance(account_name)`** — balance for a single
  named account.

### Categories

- **`moneymoney_list_categories`** — all categories with full `path`
  (e.g. `"Business > Office > IT"`) so the LLM can disambiguate
  duplicate-name branches.

### Transactions

- **`moneymoney_get_transactions(from, to, account_name?, include_closed?,
  resolve_category?, limit?)`** — date-range export, optionally restricted to
  one account or one account-group. Each transaction is enriched with
  `categoryName`/`Path`/`Root` by default. The response is capped at `limit`
  (default 1000) and reports `total_matched` / `truncated`.
- **`moneymoney_search_transactions(...)`** — same as above + filters on
  counterparty name (substring), purpose (substring), amount range, exact
  category UUID, **or `category_path_prefix`** (entire subtree, e.g.
  `"Business"`), with an optional `limit`.

### Analytics

- **`moneymoney_top_counterparties`** — top N counterparties by absolute
  total.
- **`moneymoney_get_recurring`** — subscription / recurring-payment
  detection by clustering on (counterparty, amount within ±5% with an
  absolute floor of 1.0).
- **`moneymoney_compare_periods`** — side-by-side comparison of two date
  ranges with category-path labels (no UUID cross-reference needed).
  Totals are reported per currency (`summaryByCurrency`).
- **`moneymoney_get_category_total`** — sum + count by `category_uuid` OR
  `category_path_prefix`. Totals are reported per currency
  (`totalsByCurrency`); the scalar `totalAmount`/`currency` appear only when
  all matching transactions share one currency.
- **`moneymoney_get_portfolio`** — securities (stocks, bonds, ETFs) per
  portfolio account.

### Writes (gated by `MONEYMONEY_ENABLE_WRITES=true`)

- **`moneymoney_add_transaction`** — manual entry on offline accounts.
- **`moneymoney_create_transfer`** — opens a pre-filled SEPA transfer form
  (the user must confirm in the MoneyMoney UI; the connector never sends
  autonomously).

## Account closure heuristic

If you keep historical accounts in groups whose name matches one of a small
set of keywords, every tool that returns transactions or aggregates them
**excludes those accounts by default**. The closure is exposed as
`isClosed: bool` (plus `parentGroupName` and `parentPath` for context) on
every account record.

Default keywords (case-insensitive, word-bounded, with simple inflection
tolerance for German/Italian):

```
closed, archived, archive, geschlossen, archiv, archiviert,
inaktiv, chiuso, inattivo
```

Override the list with `MONEYMONEY_CLOSED_KEYWORDS` (comma-separated). Set it
to an empty string to disable the heuristic (every account is treated as
active).

```jsonc
// list_active_accounts (or list_accounts)
{
  "name": "Checking — Bank A",
  "uuid": "abc-123",
  "isClosed": false,
  "parentGroupName": "Personal",
  "parentPath": "Personal",
  "balance": [{ "amount": 12345.67, "currency": "EUR" }],
  // ...
}
```

```jsonc
// list_accounts(include_closed=true) returns also:
{
  "name": "Old account",
  "isClosed": true,
  "parentGroupName": "Personal closed",
  "parentPath": "Personal > Personal closed",
  // ...
}
```

To inspect history (e.g. "what did I spend in 2018?"), pass
`include_closed=true` to `get_transactions` / `search_transactions` /
`top_counterparties` / etc.

## Category disambiguation

Larger MoneyMoney libraries often have the same category leaf name
(`Hotel`, `Fees`, `IT`, …) appearing in different branches. Every category
and every transaction-with-resolution is enriched with `path` so the LLM
doesn't mis-classify.

```jsonc
// list_categories
{
  "name": "IT",
  "uuid": "cat-IT-business",
  "path": "Business > Office > IT",
  "rootName": "Business",
  "parentUuid": "uuid-business-office"
}
```

To filter by branch:

```js
// All business spend, regardless of category leaf
moneymoney_search_transactions({ from_date: "2026-01-01", category_path_prefix: "Business" })

// Only "office" spend within business
moneymoney_search_transactions({ from_date: "2026-01-01", category_path_prefix: "Business > Office" })

// Sum of "Travel > Flights" for the year
moneymoney_get_category_total({ category_path_prefix: "Travel > Flights", from_date: "2026-01-01" })
```

`category_path_prefix` is **segment-aware**: `"Bus"` does NOT match
`"Business"`. Matching is case-insensitive.

## Account-name expansion

`account_name` accepts either a leaf account name or a group name. Group
names expand to all leaf accounts inside (recursively, including nested
groups), excluding closed sub-groups unless `include_closed=true`.

```js
// All transactions on personal accounts in the last 90 days
moneymoney_get_transactions({ from_date: "2026-01-25", account_name: "Personal" })

// All business transactions
moneymoney_get_transactions({ from_date: "2026-01-01", account_name: "Business" })

// One specific account
moneymoney_get_transactions({ from_date: "2026-01-01", account_name: "Checking — Bank A" })
```

If the name doesn't resolve, the error includes a list of similar names.

## Configuration

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "moneymoney": {
      "command": "/path/to/moneymoney-mcp/run.sh",
      "args": [],
      "env": {
        "MONEYMONEY_ENABLE_WRITES": "false"
      }
    }
  }
}
```

### Claude Code (CLI)

Edit `~/.claude.json` and add to the top-level `mcpServers`:

```json
{
  "mcpServers": {
    "moneymoney": {
      "command": "/path/to/moneymoney-mcp/run.sh",
      "args": [],
      "env": {
        "MONEYMONEY_ENABLE_WRITES": "false"
      }
    }
  }
}
```

The `run.sh` is self-healing: it rebuilds `dist/` if `src/` changes and
runs `npm ci` if `package-lock.json` changes (lockfile-strict, reproducible).
This means the first invocation after a clone — or after pulling updates —
will block briefly while it installs/builds. If your MCP host is sensitive
to startup latency, run `npm ci && npm run build` once manually after
cloning so subsequent launches are instant.

### Environment variables

| Variable | Default | Effect |
|---|---|---|
| `MONEYMONEY_ENABLE_WRITES` | `false` | Set to `true` to enable `add_transaction` and `create_transfer`. |
| `MONEYMONEY_CLOSED_KEYWORDS` | _(see above)_ | Comma-separated keywords used by the closed-account heuristic. Empty string disables it. |
| `MONEYMONEY_LOG_LEVEL` | `info` | Set to `debug` for verbose logs in `logs/moneymoney_mcp.log`. **Warning:** at any level, error log lines may include account names, category paths, counterparty names, or other parameters echoed by MoneyMoney; `debug` additionally captures the first 80 chars of every AppleScript command, which can contain partial IBANs or amounts. |
| `MONEYMONEY_LOG_DIR` | `<project>/logs` | Absolute path of the directory for the log files. `run.sh` sets this to the project's `logs/`. If the directory is not writable, file logging is disabled and logs go to stderr only. |
| `MONEYMONEY_DEBUG_ERRORS` | `false` | Set to `true` to include raw `osascript` stderr in error responses sent to the model. Off by default because that output can echo account names, counterparties, or amounts; when off, errors carry `raw_stderr_suppressed: true` and the full stderr is still written to the local error log. |

## Security notes

- All AppleScript built by this connector goes through an explicit escape
  layer (`escapeAppleScriptString`); injection regressions are covered by
  the tests in `tests/applescript.test.ts` and `tests/writes.test.ts`.
- Write tools never trigger a transfer autonomously: `create_transfer`
  opens the MoneyMoney payment window pre-filled, and the user must confirm.
- The connector requires the MoneyMoney database to be unlocked. It does
  not store, transmit, or attempt to discover the database password.
- `npm audit --omit=dev` returns **0 vulnerabilities**. The dev-only
  toolchain (`vitest` / `vite` / `esbuild`) carries advisories that only
  apply when their dev server is exposed to the network; they have no
  effect on the published runtime.
- Report security issues privately by opening a draft security advisory
  on the GitHub repo (Security → Report a vulnerability).

## Development

```bash
npm ci                # reproducible install (uses package-lock.json)
npm run build         # tsc → dist/
npm test              # vitest run
npm run dev           # tsc --watch
```

Test suite covers: AppleScript escape and write-script injection regression,
ISO date validation (incl. `2026-02-31` rejection and timezone-correct
formatting), error classification, recurring-detection clustering,
account/category hierarchy reconstruction, `isClosed` inference (with env
override), `resolveAccountUuids` (leaf, group expansion,
case-insensitivity), category path-prefix matching with duplicate-name
disambiguation.

## License

MIT — see [LICENSE](LICENSE).
