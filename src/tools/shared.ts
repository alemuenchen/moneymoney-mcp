import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  isAppleScriptError,
  isDatabaseLockedError,
  isInvalidDateError,
  isMoneyMoneyError,
  invalidateUnlockCache,
} from "../lib/moneymoney-client.js";
import { logger } from "../lib/logger.js";

export function checkWritesEnabled(): CallToolResult | null {
  if (process.env.MONEYMONEY_ENABLE_WRITES !== "true") {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error_type: "writes_disabled",
            error: "Write operations are disabled",
            message:
              'Set the environment variable MONEYMONEY_ENABLE_WRITES=true to enable write tools. ' +
              'In Claude Desktop config: "env": { "MONEYMONEY_ENABLE_WRITES": "true" }',
          }),
        },
      ],
      isError: true,
    };
  }
  return null;
}

/**
 * Build a structured error response. Classifies known error types so the
 * caller (Claude) can react appropriately:
 *   - database_locked: MoneyMoney is closed/locked → ask user to unlock.
 *   - invalid_argument: bad input (e.g. malformed date).
 *   - applescript_error: osascript failed → permission, syntax, etc.
 *   - moneymoney_error: upstream library threw a known error.
 *   - unknown: anything else.
 *
 * Includes a `hint` whenever we can tell the user something actionable.
 */
export function handleToolError(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : "An unknown error occurred";

  let error_type = "unknown";
  let hint = "";
  let raw_stderr: string | undefined;
  let exit_code: number | undefined;

  if (isDatabaseLockedError(err)) {
    error_type = "database_locked";
    hint = "Open MoneyMoney and unlock the database, then retry the operation.";
    invalidateUnlockCache(); // force a fresh check on next call
  } else if (isInvalidDateError(err)) {
    error_type = "invalid_argument";
    hint = "Use ISO 8601 format YYYY-MM-DD (e.g. 2026-04-25).";
  } else if (isAppleScriptError(err)) {
    error_type = "applescript_error";
    raw_stderr = err.stderr;
    exit_code = err.exitCode;
    if (err.stderr.includes("not authorized") || err.stderr.includes("-1743")) {
      hint = "macOS Automation permission missing. Enable in System Settings → Privacy & Security → Automation: allow node/Terminal to control MoneyMoney.";
    } else if (err.stderr.includes("application isn't running")) {
      hint = "MoneyMoney is not running. Open the app first.";
    }
  } else if (isMoneyMoneyError(err)) {
    error_type = "moneymoney_error";
  }

  logger.error("tool error", { error_type, message, exit_code, raw_stderr });

  const payload: Record<string, unknown> = {
    error_type,
    error: message,
  };
  if (hint) payload.hint = hint;
  // Privacy-first: raw osascript stderr can echo account names, category
  // paths, counterparty names or amounts. It is withheld from the MCP
  // response unless MONEYMONEY_DEBUG_ERRORS=true is set explicitly. The
  // full stderr is always written to the local error log regardless.
  if (raw_stderr) {
    if (process.env.MONEYMONEY_DEBUG_ERRORS === "true") {
      payload.raw_stderr = raw_stderr;
    } else {
      payload.raw_stderr_suppressed = true;
    }
  }
  if (exit_code !== undefined) payload.exit_code = exit_code;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload),
      },
    ],
    isError: true,
  };
}
