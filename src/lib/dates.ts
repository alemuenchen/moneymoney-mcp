// Date helpers used across the codebase. Two correctness traps the naive
// JS Date API falls into:
//
//   1. `new Date("2026-02-31T00:00:00")` does NOT return Invalid Date — it
//      silently normalizes to Mar 3. Roundtripping year/month/day catches it.
//
//   2. `d.toISOString().split("T")[0]` shifts to UTC. For midnight in a
//      timezone east of UTC (e.g. Europe/Berlin = UTC+1/+2), it returns the
//      previous day's date. We use local components instead.

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class InvalidDateError extends Error {
  constructor(value: string, field: string) {
    super(`Invalid ISO 8601 date in ${field}: "${value}". Expected format YYYY-MM-DD.`);
    this.name = "InvalidDateError";
  }
}

export function parseISODate(value: string, field: string): Date {
  const match = ISO_DATE_RE.exec(value);
  if (!match) throw new InvalidDateError(value, field);
  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const day = parseInt(match[3]!, 10);
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    throw new InvalidDateError(value, field);
  }
  return d;
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daysBetween(a: string, b: string): number {
  const da = parseISODate(a, "a").getTime();
  const db = parseISODate(b, "b").getTime();
  return Math.round((db - da) / (1000 * 60 * 60 * 24));
}
