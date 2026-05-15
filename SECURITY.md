# Security Policy

## Reporting a Vulnerability

If you find a security issue in `moneymoney-mcp`, please **do not open a
public GitHub issue**. Instead, use one of:

1. **GitHub private security advisory** (preferred): on the repository
   page, go to **Security → Report a vulnerability**.
2. **Direct email** to the maintainer listed in `package.json` → `author`.

Please include:

- the version you are running (`package.json` → `version`, or
  `git rev-parse HEAD` if running from source),
- a minimal reproduction or proof of concept,
- the impact you believe the issue has.

I aim to acknowledge reports within 7 days and to publish a fix or
mitigation within 30 days for confirmed issues, depending on severity.

## Threat Model

`moneymoney-mcp` is a single-user, local-only MCP server that talks to the
MoneyMoney macOS app via AppleScript. It does not expose a network
listener and does not store credentials. Relevant trust boundaries:

| Source | Trusted? | Notes |
|---|---|---|
| MCP host process (Claude Desktop / Claude Code) | yes | runs as your user |
| MCP tool arguments (LLM-generated) | **no** | escaped before reaching AppleScript |
| MoneyMoney AppleScript output | yes | parsed via `plist` |
| Environment variables | yes | provided by you in MCP host config |

## Defenses Already In Place

- All AppleScript built by the connector escapes string parameters via
  `escapeAppleScriptString`. Injection regression is asserted in
  `tests/applescript.test.ts` and `tests/writes.test.ts`.
- Write tools (`add_transaction`, `create_transfer`) are **disabled by
  default** and require `MONEYMONEY_ENABLE_WRITES=true` to call.
- `create_transfer` only opens a pre-filled MoneyMoney payment window;
  it does not send autonomously. Confirmation in the MoneyMoney UI is
  always required.
- The connector requires the MoneyMoney database to be unlocked. It
  does not store, transmit, or attempt to discover the database
  password.
- `npm audit --omit=dev` returns 0 vulnerabilities at every release.
