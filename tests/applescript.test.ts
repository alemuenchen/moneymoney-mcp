import { describe, it, expect } from "vitest";
import { escapeAppleScriptString } from "../src/lib/applescript.js";

// These tests cover the AppleScript-injection fix (Bug 1+2). They are pure
// string transformations — no MoneyMoney runtime needed.

describe("escapeAppleScriptString", () => {
  it("returns empty literal for empty input", () => {
    expect(escapeAppleScriptString("")).toBe('""');
  });

  it("wraps simple text in double quotes", () => {
    expect(escapeAppleScriptString("hello")).toBe('"hello"');
  });

  it("preserves the + character (regression: things3-mcp Bug 4 pattern)", () => {
    const out = escapeAppleScriptString("€ 16,00 + € 30,46");
    expect(out).toContain("+");
  });

  it("encodes embedded double quotes via ASCII character 34", () => {
    const out = escapeAppleScriptString('Re: "Daily Digest"');
    // Quotes around "Daily Digest" must be encoded, not pass through verbatim
    expect(out).toContain("(ASCII character 34)");
    // The output is built as a concatenation of quoted segments + ASCII 34
    expect(out).toMatch(/^"Re: " \& \(ASCII character 34\) \& "Daily Digest" \& \(ASCII character 34\)$/);
  });

  it("encodes newlines via ASCII character 10", () => {
    const out = escapeAppleScriptString("line one\nline two");
    expect(out).toContain("(ASCII character 10)");
  });

  it("replaces tabs and CRs with spaces", () => {
    const out = escapeAppleScriptString("a\tb\rc");
    // Tab and CR must not appear in the literal
    expect(out).not.toMatch(/[\t\r]/);
  });

  it("handles ä ö ü ß (German) without mangling", () => {
    expect(escapeAppleScriptString("Müller GmbH")).toBe('"Müller GmbH"');
    expect(escapeAppleScriptString("Größe")).toBe('"Größe"');
  });

  it("handles Italian accented characters", () => {
    expect(escapeAppleScriptString("è già pagato")).toBe('"è già pagato"');
  });

  it("handles Serbian-latin characters", () => {
    expect(escapeAppleScriptString("Č Ć Š Ž Đ")).toBe('"Č Ć Š Ž Đ"');
  });

  it("does not break on a string that is just a quote", () => {
    const out = escapeAppleScriptString('"');
    expect(out).toContain("(ASCII character 34)");
  });

  it("survives malicious AppleScript injection attempts", () => {
    // Simulating a hypothetical injection: account name designed to escape
    // the literal and execute something nasty.
    const evil = '" & (do shell script "rm -rf /") & "';
    const out = escapeAppleScriptString(evil);
    // The single quote-character escape MUST be present so that the upstream
    // command sees this as a literal string, not as code.
    expect(out).toContain("(ASCII character 34)");
    // The whole `& (do shell` substring must be inside a quoted segment, not
    // dangling outside.
    // Easiest check: the output never contains an unbalanced AppleScript
    // operator outside quotes.
    // Heuristic: count of unescaped backticks — should be zero.
    const stripped = out.replace(/"[^"]*"/g, "");
    expect(stripped).not.toMatch(/do shell script/);
  });
});
