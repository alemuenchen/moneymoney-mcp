# Contributing

Thanks for considering a contribution to `moneymoney-mcp`.

## Bug reports

Open an issue with:

- the `moneymoney-mcp` version (`package.json` → `version`),
- the MoneyMoney version (Help → About MoneyMoney),
- macOS version,
- the MCP host (Claude Desktop / Claude Code / other) and its version,
- a minimal reproduction (the MCP tool call and the response/error).

Do not include real account names, IBANs, transaction amounts, or
counterparty names. Use placeholders.

For security issues, see [SECURITY.md](./SECURITY.md) instead.

## Pull requests

1. Open an issue first for non-trivial changes so we can align on scope.
2. Keep the diff focused — one concern per PR.
3. Run the local checks before pushing:
   ```bash
   npm ci
   npm run build
   npm test
   npm audit --omit=dev
   ```
   All four must pass.
4. Add tests for any new behavior. The suite is `vitest` and lives in
   `tests/`. AppleScript-emitting code paths must have an injection
   regression test.
5. Keep tool descriptions terse and example-driven; the audience is an
   LLM that reads them once per call.
6. Follow the existing code style (TypeScript strict, ESM, no default
   exports, explicit types on public surface).

## Releases

Versions follow [Semantic Versioning](https://semver.org/). The
`CHANGELOG.md` is updated as part of the release commit. Tagging is
done via `git tag vX.Y.Z` and a GitHub Release is created for each tag.
