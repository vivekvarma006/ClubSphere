import { expect, it } from "vitest";
import { contentSecurityPolicy } from "@/lib/content-security-policy";
it("requires nonces for production scripts and limits origins", () => {
  const policy = contentSecurityPolicy("test-nonce", false);
  expect(policy).toContain(
    "script-src 'self' 'nonce-test-nonce' 'strict-dynamic'",
  );
  expect(policy).not.toContain("unsafe-eval");
  expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("connect-src 'self';");
});
it("allows dev-only HMR and eval", () => {
  expect(contentSecurityPolicy("dev-nonce", true)).toContain("'unsafe-eval'");
  expect(contentSecurityPolicy("dev-nonce", true)).toContain("ws: wss:");
});

it.each([
  ["https://auth.example.test/some/path?query=1", " https://auth.example.test"],
  ["http://127.0.0.1:54321", " http://127.0.0.1:54321"],
  ["not a URL; script-src *", ""],
])(
  "scopes OAuth form redirects to the configured provider origin: %s",
  (url, expected) => {
    const policy = contentSecurityPolicy("nonce", false, url);
    expect(policy.split("; ").at(-1)).toBe(
      `form-action 'self' https://accounts.google.com${expected}`,
    );
  },
);
