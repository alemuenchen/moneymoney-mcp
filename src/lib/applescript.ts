// AppleScript safety layer.
//
// MoneyMoney exposes its scripting via osascript. The previous implementation
// used `osascript -e <multiline script>` and string-interpolated user input
// (e.g. account name) directly into the script body, which (a) breaks on quotes
// and special characters and (b) opens an AppleScript injection surface (low
// blast radius but bad pattern). This module fixes both:
//   - `escapeAppleScriptString` produces safe AppleScript string literals using
//     the (ASCII character 34) trick that AppleScript itself documents for
//     embedding double quotes.
//   - `runAppleScript` writes the script to a temporary file and runs it via
//     `osascript <file>`, mirroring the pattern adopted by things3-mcp after
//     the 2026-04-24 hardening.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export class AppleScriptError extends Error {
  readonly stderr: string;
  readonly exitCode: number;
  constructor(message: string, stderr: string, exitCode: number) {
    super(message);
    this.name = "AppleScriptError";
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

/**
 * Escape an arbitrary string so it can be embedded as an AppleScript string
 * literal. AppleScript has no general escape mechanism; the convention is to
 * concatenate quoted segments around `(ASCII character 34)` for double quotes
 * and `(ASCII character 10)` for newlines, while replacing tabs and CRs with
 * spaces (they break script parsing).
 */
export function escapeAppleScriptString(text: string): string {
  if (!text) return '""';

  // Tabs and CR are unsafe inside AppleScript literals; replace with space.
  // LF we keep, encoded as ASCII character 10 below.
  const cleaned = text.replace(/[\t\r]/g, " ");

  if (!cleaned.includes('"') && !cleaned.includes("\n") && !cleaned.includes("\\")) {
    return `"${cleaned}"`;
  }

  const parts: string[] = [];
  let current = "";
  for (const ch of cleaned) {
    if (ch === '"') {
      if (current) {
        parts.push(`"${current.replace(/\\/g, "\\\\")}"`);
        current = "";
      }
      parts.push("(ASCII character 34)");
    } else if (ch === "\n") {
      if (current) {
        parts.push(`"${current.replace(/\\/g, "\\\\")}"`);
        current = "";
      }
      parts.push("(ASCII character 10)");
    } else {
      current += ch;
    }
  }
  if (current) parts.push(`"${current.replace(/\\/g, "\\\\")}"`);
  return parts.length ? parts.join(" & ") : '""';
}

export interface RunAppleScriptOptions {
  /** Max stdout buffer in bytes. Default 50MB to avoid silently truncating
   *  large portfolio exports. */
  maxBuffer?: number;
  /** Timeout in milliseconds. Default 30s. */
  timeoutMs?: number;
}

/**
 * Run an AppleScript by writing it to a temp file and invoking
 * `osascript <file>`. Always preferred over `osascript -e <inline>` for any
 * non-trivial script: avoids shell quoting surprises with embedded quotes,
 * newlines, and unicode.
 *
 * Returns stdout (trimmed). Throws `AppleScriptError` with stderr + exit code
 * on non-zero exit, so callers can surface actionable messages to the user.
 */
export async function runAppleScript(
  script: string,
  options: RunAppleScriptOptions = {},
): Promise<string> {
  const maxBuffer = options.maxBuffer ?? 50 * 1024 * 1024;
  const timeout = options.timeoutMs ?? 30_000;

  const dir = await mkdtemp(join(tmpdir(), "moneymoney-mcp-"));
  const scriptPath = join(dir, "script.applescript");
  try {
    await writeFile(scriptPath, script, "utf8");
    const { stdout, stderr } = await execFileAsync("osascript", [scriptPath], {
      maxBuffer,
      timeout,
    });
    if (stdout.length >= maxBuffer * 0.95) {
      // Within 5% of the limit — likely truncated. Surface it loudly.
      throw new AppleScriptError(
        `osascript output reached ${stdout.length} bytes (≥95% of maxBuffer ${maxBuffer}). Increase maxBuffer to capture full result.`,
        stderr ?? "",
        0,
      );
    }
    return stdout.trim();
  } catch (err: unknown) {
    if (err instanceof AppleScriptError) throw err;
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    const stderr = e.stderr ?? "";
    const exitCode = typeof e.code === "number" ? e.code : 1;
    throw new AppleScriptError(
      e.message ?? "osascript failed",
      stderr,
      exitCode,
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
