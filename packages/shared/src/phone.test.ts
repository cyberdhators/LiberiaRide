import { describe, expect, it } from "vitest";
import { formatPhone, liberianNetwork, maskPhone, normalizePhone } from "./phone";
import { isValidIdempotencyKey, newIdempotencyKey } from "./idempotency";

describe("normalizePhone", () => {
  it.each([
    ["0770123456", "+231770123456"],
    ["077 012 3456", "+231770123456"],
    ["+231 88 612 3456", "+231886123456"],
    ["231555123456", "+231555123456"],
    ["00231770123456", "+231770123456"],
    ["+44 7700 900123", "+447700900123"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "abc", "+231 12", "0"])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("identifies networks", () => {
    expect(liberianNetwork("+231770123456")).toBe("orange");
    expect(liberianNetwork("+231886123456")).toBe("lonestar_mtn");
    expect(liberianNetwork("+231555123456")).toBe("lonestar_mtn");
    expect(liberianNetwork("+447700900123")).toBe("unknown");
  });

  it("formats and masks", () => {
    expect(formatPhone("+231770123456")).toBe("+231 77 012 3456");
    expect(maskPhone("+231770123456")).toBe("+•••••••••456");
  });
});

describe("idempotency keys", () => {
  it("generates unique valid keys", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(isValidIdempotencyKey(a)).toBe(true);
    expect(isValidIdempotencyKey("short")).toBe(false);
    expect(isValidIdempotencyKey("has space in it")).toBe(false);
  });
});
