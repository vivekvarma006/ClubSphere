import { expect, test } from "@playwright/test";

// HTTP-level checks of the built app. They need no browser and no Supabase.

test("home page renders without any club-specific branding", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("ClubSphere");
});

test("responses carry baseline security headers", async ({ request }) => {
  const headers = (await request.get("/")).headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("health check reports status without leaking internals", async ({ request }) => {
  const res = await request.get("/api/health");
  expect([200, 503]).toContain(res.status());
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = (await res.json()) as Record<string, unknown>;
  expect(["ok", "degraded"]).toContain(body.status);
  expect(JSON.stringify(body)).not.toMatch(/postgres|password|error|stack|host/i);
});

test("auth callback without a code goes to the error page, ignoring off-site next", async ({ request }) => {
  const res = await request.get("/auth/callback?next=https://evil.example", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toMatch(/\/auth\/error\?reason=missing_code$/);
});

test("auth confirm rejects unknown link types", async ({ request }) => {
  const res = await request.get("/auth/confirm?token_hash=x&type=admin", { maxRedirects: 0 });
  expect(res.headers().location).toMatch(/\/auth\/error\?reason=invalid_link$/);
});

test("auth error page explains known reasons", async ({ request }) => {
  const res = await request.get("/auth/error?reason=link_expired");
  expect(await res.text()).toContain("This link has expired or has already been used.");
});

test("auth error page treats inherited object keys as unknown reasons", async ({ request }) => {
  for (const reason of ["__proto__", "constructor", "toString"]) {
    const res = await request.get(`/auth/error?reason=${reason}`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("Something went wrong while signing you in.");
  }
});

test("password recovery destination exists and explains a missing session", async ({ request }) => {
  const res = await request.get("/auth/update-password");
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("Choose a new password");
  expect(html).toContain("Open the password recovery link");
  expect(html).not.toContain('name="password"');
});
