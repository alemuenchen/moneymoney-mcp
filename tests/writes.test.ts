import { describe, it, expect } from "vitest";
import {
  buildAddTransactionScript,
  buildCreateBankTransferScript,
} from "../src/lib/moneymoney-client.js";

// These tests assert that the locally-built AppleScript for write operations
// is injection-safe: every string parameter must go through
// escapeAppleScriptString, so a value designed to escape the literal and
// inject AppleScript code stays a literal.

describe("buildAddTransactionScript", () => {
  it("emits well-formed script with all fields", () => {
    const script = buildAddTransactionScript({
      account: "Checking 1",
      amount: -42.5,
      to: "Acme Corp",
      date: new Date(2026, 0, 15),
      purpose: "Office supplies",
      category: "uuid-abc-123",
    });
    expect(script).toContain("add transaction");
    expect(script).toContain('to account "Checking 1"');
    expect(script).toContain('on date "2026-01-15"');
    expect(script).toContain('to "Acme Corp"');
    expect(script).toContain("amount -42.5");
    expect(script).toContain('purpose "Office supplies"');
    expect(script).toContain('category "uuid-abc-123"');
  });

  it("omits optional clauses when undefined", () => {
    const script = buildAddTransactionScript({
      account: "Cash",
      amount: 10,
      to: "Vendor",
      date: new Date(2026, 5, 1),
    });
    expect(script).not.toContain("purpose");
    expect(script).not.toContain("category");
  });

  it("escapes embedded quotes and would-be injection in account name", () => {
    const evil = '" & (do shell script "rm -rf /") & "';
    const script = buildAddTransactionScript({
      account: evil,
      amount: 1,
      to: "X",
      date: new Date(2026, 0, 1),
    });
    expect(script).toContain("(ASCII character 34)");
    // The dangerous fragment must not appear unquoted (i.e. outside a "...")
    const stripped = script.replace(/"[^"]*"/g, "");
    expect(stripped).not.toMatch(/do shell script/);
    expect(stripped).not.toMatch(/rm -rf/);
  });

  it("escapes injection attempts in purpose, name, category", () => {
    const evil = '" & (system attribute "PATH") & "';
    for (const field of ["to", "purpose", "category"] as const) {
      const opts = {
        account: "A",
        amount: 1,
        to: "x",
        date: new Date(2026, 0, 1),
      } as Parameters<typeof buildAddTransactionScript>[0];
      (opts as Record<string, unknown>)[field] = evil;
      const script = buildAddTransactionScript(opts);
      const stripped = script.replace(/"[^"]*"/g, "");
      expect(stripped).not.toMatch(/system attribute/);
    }
  });

  it("rejects non-finite amount", () => {
    const base = {
      account: "A",
      to: "X",
      date: new Date(2026, 0, 1),
    } as const;
    expect(() => buildAddTransactionScript({ ...base, amount: Number.NaN })).toThrow(
      /finite/,
    );
    expect(() => buildAddTransactionScript({ ...base, amount: Number.POSITIVE_INFINITY })).toThrow(
      /finite/,
    );
  });

  it("formats the date using local components (no UTC drift)", () => {
    // Midnight Jan 1 2026 local — naive toISOString would emit 2025-12-31 in
    // any tz east of UTC. Our toISODate stays local.
    const script = buildAddTransactionScript({
      account: "A",
      amount: 1,
      to: "X",
      date: new Date(2026, 0, 1),
    });
    expect(script).toContain('on date "2026-01-01"');
    expect(script).not.toContain("2025-12-31");
  });
});

describe("buildCreateBankTransferScript", () => {
  it("emits well-formed script with all fields", () => {
    // IBANs in this file are well-known textbook fixtures used by Wikipedia
    // and ISO/IEC 7064 documentation — not real accounts.
    const script = buildCreateBankTransferScript({
      fromAccount: "DE89 3704 0044 0532 0130 00",
      to: "Beneficiary GmbH",
      iban: "DE12500105170648489890",
      amount: 100.5,
      purpose: "Invoice 2026-001",
    });
    expect(script).toContain("create bank transfer");
    expect(script).toContain('from account "DE89 3704 0044 0532 0130 00"');
    expect(script).toContain('to "Beneficiary GmbH"');
    expect(script).toContain('iban "DE12500105170648489890"');
    expect(script).toContain("amount 100.5");
    expect(script).toContain('purpose "Invoice 2026-001"');
  });

  it("escapes injection attempts across every string field", () => {
    const evil = '" & (do shell script "say boom") & "';
    const script = buildCreateBankTransferScript({
      fromAccount: evil,
      to: evil,
      iban: evil,
      amount: 1,
      purpose: evil,
    });
    const stripped = script.replace(/"[^"]*"/g, "");
    expect(stripped).not.toMatch(/do shell script/);
    expect(stripped).not.toMatch(/say boom/);
    // Every dangerous segment should have been encoded via ASCII 34.
    expect(script).toContain("(ASCII character 34)");
  });

  it("rejects non-finite amount", () => {
    const base = {
      fromAccount: "A",
      to: "X",
      iban: "DE00",
      purpose: "p",
    } as const;
    expect(() => buildCreateBankTransferScript({ ...base, amount: Number.NaN })).toThrow(
      /finite/,
    );
  });

  it("omits empty purpose", () => {
    const script = buildCreateBankTransferScript({
      fromAccount: "A",
      to: "X",
      iban: "DE00",
      amount: 1,
      purpose: "",
    });
    expect(script).not.toContain("purpose");
  });
});
