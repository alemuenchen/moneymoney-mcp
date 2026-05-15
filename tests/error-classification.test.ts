import { describe, it, expect } from "vitest";
import {
  isAppleScriptError,
  isInvalidDateError,
  AppleScriptError,
  InvalidDateError,
} from "../src/lib/moneymoney-client.js";

describe("error classification", () => {
  it("AppleScriptError is recognised", () => {
    const err = new AppleScriptError("boom", "stderr-data", 1);
    expect(isAppleScriptError(err)).toBe(true);
    expect(err.stderr).toBe("stderr-data");
    expect(err.exitCode).toBe(1);
  });

  it("InvalidDateError is recognised", () => {
    const err = new InvalidDateError("not-a-date", "from_date");
    expect(isInvalidDateError(err)).toBe(true);
  });

  it("plain Error is not classified as a domain error", () => {
    const err = new Error("generic");
    expect(isAppleScriptError(err)).toBe(false);
    expect(isInvalidDateError(err)).toBe(false);
  });
});
