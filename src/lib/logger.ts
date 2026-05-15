// Lightweight structured logger.
//
// Avoids adding a heavy dependency (pino/winston) — node has enough primitives
// for a few-hundred-LOC connector. Writes JSON lines to:
//   - logs/moneymoney_mcp.log         (info+)
//   - logs/moneymoney_mcp_errors.log  (error only)
// Falls back to stderr-only if logs/ is not writable.
//
// Log level controlled via env var `MONEYMONEY_LOG_LEVEL` ∈ {debug, info, warn, error}.
// Default: info.

import { appendFile, mkdir } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const __filename = fileURLToPath(import.meta.url);
// dist/lib/logger.js → ../../logs at runtime, src/lib/logger.ts → ../../logs at dev
const PROJECT_ROOT = resolve(dirname(__filename), "..", "..");
// MONEYMONEY_LOG_DIR overrides the default; run.sh sets it to the project's
// logs/ dir. If the chosen directory is not writable, file logging is
// disabled below and the logger falls back to stderr only.
const LOG_DIR = process.env.MONEYMONEY_LOG_DIR
  ? resolve(process.env.MONEYMONEY_LOG_DIR)
  : join(PROJECT_ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "moneymoney_mcp.log");
const ERR_FILE = join(LOG_DIR, "moneymoney_mcp_errors.log");

const configured = (process.env.MONEYMONEY_LOG_LEVEL ?? "info").toLowerCase();
const minLevel = LEVELS[configured as Level] ?? LEVELS.info;

let logsAvailable = true;
try {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
} catch {
  logsAvailable = false;
}

async function write(level: Level, msg: string, extra?: Record<string, unknown>): Promise<void> {
  if (LEVELS[level] < minLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(extra ?? {}),
  };
  const line = JSON.stringify(entry) + "\n";
  // Always emit to stderr so Claude Desktop's stdio capture sees it.
  process.stderr.write(line);
  if (!logsAvailable) return;
  try {
    await appendFile(LOG_FILE, line, "utf8");
    if (level === "error") await appendFile(ERR_FILE, line, "utf8");
  } catch {
    // Disable file logging if it persistently fails.
    logsAvailable = false;
  }
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => void write("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => void write("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => void write("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => void write("error", msg, extra),
};

/** Ensure the logs/ directory exists (idempotent). */
export async function ensureLogDir(): Promise<void> {
  if (!logsAvailable) return;
  try {
    await mkdir(LOG_DIR, { recursive: true });
  } catch {
    logsAvailable = false;
  }
}
