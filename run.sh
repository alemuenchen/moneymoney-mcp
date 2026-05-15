#!/usr/bin/env bash
# Self-healing wrapper for moneymoney-mcp.
#
#   - rebuilds dist/ if missing or out of date vs src/
#   - reinstalls node_modules if package-lock.json checksum changed
#     (uses `npm ci` for reproducible, lockfile-strict installs)
#   - keeps logs/ inside the project (no scattered home-directory files)
#   - emits ALL diagnostics on stderr; stdout is reserved for stdio MCP
#     JSON-RPC framing
#
# MCP host config (Claude Desktop / Claude Code) should point to this script
# as the command, not directly at dist/index.js, so upgrades and clean
# checkouts self-heal.
set -euo pipefail

NAME="moneymoney-mcp"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

LOGS_DIR="$HERE/logs"
mkdir -p "$LOGS_DIR"

# ------------------ self-healing block ------------------

if ! command -v node >/dev/null 2>&1; then
  echo "[$NAME] Node.js not found in PATH. Install Node ≥20 (e.g. https://nodejs.org)." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[$NAME] npm not found in PATH." >&2
  exit 1
fi

# Reinstall deps if package-lock has changed since last successful install.
# We use `npm ci` (lockfile-strict, reproducible) instead of `npm install`,
# so a clean checkout never silently bumps minor versions.
if [ -f package-lock.json ]; then
  lock_sha=$(shasum -a 256 package-lock.json | awk '{print $1}')
  installed_sha=$(cat node_modules/.deps_sha256 2>/dev/null || echo "")
  if [ ! -d node_modules ] || [ "$lock_sha" != "$installed_sha" ]; then
    echo "[$NAME] dependencies changed or missing — running npm ci…" >&2
    npm ci --silent --no-audit --no-fund
    mkdir -p node_modules
    echo "$lock_sha" > node_modules/.deps_sha256
  fi
fi

# Rebuild dist if missing or any src file is newer than the build.
needs_build=0
if [ ! -d dist ] || [ ! -f dist/index.js ]; then
  needs_build=1
else
  newest_src=$(find src -type f -name "*.ts" -exec stat -f "%m" {} \; | sort -nr | head -1)
  newest_dist=$(stat -f "%m" dist/index.js 2>/dev/null || echo 0)
  if [ -n "$newest_src" ] && [ "$newest_src" -gt "$newest_dist" ]; then
    needs_build=1
  fi
fi

if [ "$needs_build" = 1 ]; then
  echo "[$NAME] (re)building TypeScript…" >&2
  npm run build --silent
fi

# ------------------ launch ------------------
export MONEYMONEY_LOG_DIR="$LOGS_DIR"
exec node dist/index.js
