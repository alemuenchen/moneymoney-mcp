# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 — Initial public release

First public release. The connector exposes the MoneyMoney macOS banking
app to LLM hosts via the Model Context Protocol.

### Tools (13 total, prefix `moneymoney_`)

- **Accounts:** `list_accounts`, `list_active_accounts`, `get_account_balance`
- **Categories:** `list_categories`
- **Transactions:** `get_transactions`, `search_transactions`
- **Analytics:** `top_counterparties`, `get_recurring`, `compare_periods`,
  `get_category_total`, `get_portfolio`
- **Writes (gated by `MONEYMONEY_ENABLE_WRITES=true`):** `add_transaction`,
  `create_transfer`

### Design choices

- **AppleScript safety.** Every parameter that ends up in an AppleScript
  literal is escaped through a single sanitizer
  (`escapeAppleScriptString`). Both read and write paths are covered;
  injection regression is asserted in unit tests.
- **Locally patched account filter.** The connector does not rely on the
  upstream `moneymoney` npm library's `forAccount` option (broken on
  current MoneyMoney builds). Instead it fetches the full date window
  and filters client-side, which also enables group-name expansion
  (passing a group name resolves to all leaf accounts inside).
- **Closed-account heuristic.** Configurable via
  `MONEYMONEY_CLOSED_KEYWORDS` (default covers English, German, and
  Italian variants with simple inflection tolerance). Disabled by setting
  the env var to an empty string.
- **Date validation.** Strict `YYYY-MM-DD` parser with roundtrip check
  (rejects `2026-02-31` and similar silent normalizations) and
  timezone-correct local-component formatter (no UTC drift on midnight).
- **Hierarchy reconstruction.** Both account and category trees are
  rebuilt from MoneyMoney's flat `indentation`-tagged list, with full
  `path` and `rootName` exposed on every record. Resolves the common
  duplicate-leaf-name problem in larger libraries.
- **Caching.** Lock check cached for 30 s; account/category hierarchy
  cached for 60 s. Both invalidate automatically on `DatabaseLockedError`.
- **Errors.** Tool responses use a typed envelope
  (`AppleScriptError`, `DatabaseLockedError`, `MoneyMoneyError`,
  `InvalidDateError`) with actionable hints and stderr passthrough.
- **Logging.** Stderr-only diagnostics in the wrapper (`run.sh`); stdout
  is reserved for stdio MCP JSON-RPC framing. File logs are written to
  `logs/moneymoney_mcp.log` (info level and above by default; set
  `MONEYMONEY_LOG_LEVEL=debug` for verbose output).

### Compatibility

- macOS only (AppleScript). Declared via `os: ["darwin"]` in
  `package.json`.
- Node.js ≥ 20.
- MoneyMoney must be running and unlocked while the connector is in use.
