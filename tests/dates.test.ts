import { describe, it, expect } from "vitest";
import {
  parseISODate,
  toISODate,
  daysBetween,
  InvalidDateError,
} from "../src/lib/dates.js";

describe("parseISODate", () => {
  it("accepts well-formed ISO dates", () => {
    expect(parseISODate("2026-04-25", "from").getFullYear()).toBe(2026);
    expect(parseISODate("1990-01-01", "from").getMonth()).toBe(0);
    expect(parseISODate("2099-12-31", "to").getDate()).toBe(31);
  });

  it("rejects malformed shapes", () => {
    expect(() => parseISODate("yesterday", "f")).toThrow(InvalidDateError);
    expect(() => parseISODate("2026/04/25", "f")).toThrow(InvalidDateError);
    expect(() => parseISODate("25-04-2026", "f")).toThrow(InvalidDateError);
    expect(() => parseISODate("2026-4-5", "f")).toThrow(InvalidDateError);
    expect(() => parseISODate("", "f")).toThrow(InvalidDateError);
  });

  it("rejects out-of-range months and days that pass the regex", () => {
    expect(() => parseISODate("2026-13-01", "f")).toThrow(InvalidDateError);
    expect(() => parseISODate("2026-00-01", "f")).toThrow(InvalidDateError);
    expect(() => parseISODate("2026-01-00", "f")).toThrow(InvalidDateError);
    expect(() => parseISODate("2026-01-32", "f")).toThrow(InvalidDateError);
  });

  it("rejects dates that JS would silently normalize", () => {
    // 2026-02-31 → Mar 3 in bare new Date(); we reject it.
    expect(() => parseISODate("2026-02-31", "f")).toThrow(InvalidDateError);
    expect(() => parseISODate("2025-02-29", "f")).toThrow(InvalidDateError);
    expect(() => parseISODate("2026-04-31", "f")).toThrow(InvalidDateError);
    expect(() => parseISODate("2026-09-31", "f")).toThrow(InvalidDateError);
  });

  it("accepts Feb 29 in leap years", () => {
    expect(parseISODate("2024-02-29", "f").getDate()).toBe(29);
    expect(parseISODate("2000-02-29", "f").getDate()).toBe(29);
  });

  it("InvalidDateError carries field and value for diagnostics", () => {
    try {
      parseISODate("yesterday", "from_date");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidDateError);
      expect((err as Error).message).toContain("from_date");
      expect((err as Error).message).toContain("yesterday");
      expect((err as Error).message).toContain("YYYY-MM-DD");
      expect((err as Error).name).toBe("InvalidDateError");
    }
  });
});

describe("toISODate (timezone-correct)", () => {
  it("formats midnight local time as the local date, not UTC", () => {
    // The classic bug: toISOString() shifts to UTC. In any timezone east of
    // UTC (Europe, Asia, Australia), midnight Jan 1 local becomes the
    // previous day in UTC. Our toISODate uses local components and is
    // immune.
    const jan1Local = new Date(2026, 0, 1); // local midnight
    expect(toISODate(jan1Local)).toBe("2026-01-01");

    const dec31Local = new Date(2026, 11, 31);
    expect(toISODate(dec31Local)).toBe("2026-12-31");
  });

  it("zero-pads single-digit months and days", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toISODate(new Date(2026, 8, 1))).toBe("2026-09-01");
  });

  it("roundtrips with parseISODate", () => {
    for (const s of ["2026-01-01", "2026-04-25", "2024-02-29", "1990-12-31"]) {
      expect(toISODate(parseISODate(s, "f"))).toBe(s);
    }
  });
});

describe("daysBetween", () => {
  it("counts whole days between two ISO dates", () => {
    expect(daysBetween("2026-01-01", "2026-01-02")).toBe(1);
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
  });

  it("returns 0 for the same date", () => {
    expect(daysBetween("2026-04-25", "2026-04-25")).toBe(0);
  });

  it("returns negative for reversed range", () => {
    expect(daysBetween("2026-01-02", "2026-01-01")).toBe(-1);
  });

  it("survives the spring DST transition (Europe/Berlin)", () => {
    // Mar 30 2025 02:00 CET → 03:00 CEST (loses 1 hour). The naive
    // millisecond subtraction would yield 0.95 days; rounding still gives 1
    // because we use Math.round, but the test pins the behavior.
    expect(daysBetween("2025-03-29", "2025-03-30")).toBe(1);
    expect(daysBetween("2025-03-29", "2025-03-31")).toBe(2);
  });

  it("rejects malformed inputs (delegates to parseISODate)", () => {
    expect(() => daysBetween("yesterday", "2026-01-01")).toThrow(InvalidDateError);
    expect(() => daysBetween("2026-02-31", "2026-03-01")).toThrow(InvalidDateError);
  });
});
