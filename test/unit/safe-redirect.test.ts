import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath", () => {
  it.each([
    ["/o/club/dashboard", "/o/club/dashboard"],
    ["/requests?status=pending#top", "/requests?status=pending#top"],
    ["/", "/"],
  ])("keeps same-site path %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "relative/path",
    "/ok\nSet-Cookie: x=1",
    `/${"a".repeat(600)}`,
  ])("falls back for %j", (input) => {
    expect(safeNextPath(input, "/home")).toBe("/home");
  });
});
