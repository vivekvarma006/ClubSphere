import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Supabase Auth is replaced with a controllable fake. These tests cover the
// application's handling of callbacks and links; the Auth server's own
// behaviour (Google OAuth, sending emails) is exercised in the E2E suite
// against a real Supabase project.
const auth = {
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  getClaims: vi.fn(),
};
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth }),
}));

const { GET: callback } = await import("@/app/auth/callback/route");
const { GET: confirm } = await import("@/app/auth/confirm/route");
const { getVerifiedActor } = await import("@/server/auth/session");

const USER_ID = "8f9c2f4e-3b1a-4c55-9d1e-2b7a6c0d1e2f";
const ok = { data: {}, error: null };
const authError = { data: {}, error: { status: 400, code: "bad_code", message: "invalid" } };

const get = (path: string) => new NextRequest(new URL(path, "https://app.example.test"));
const location = (res: Response) => res.headers.get("location");

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /auth/callback", () => {
  it("exchanges the code and redirects to a same-site next path", async () => {
    auth.exchangeCodeForSession.mockResolvedValue(ok);
    const res = await callback(get("/auth/callback?code=abc&next=/o/club"));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(location(res)).toBe("https://app.example.test/o/club");
  });

  it("ignores an off-site next parameter (open redirect)", async () => {
    auth.exchangeCodeForSession.mockResolvedValue(ok);
    const res = await callback(get("/auth/callback?code=abc&next=https://evil.example"));
    expect(location(res)).toBe("https://app.example.test/");
  });

  it("rejects paths that normalize into a protocol-relative redirect", async () => {
    auth.exchangeCodeForSession.mockResolvedValue(ok);
    const res = await callback(get("/auth/callback?code=abc&next=" + encodeURIComponent("/a/..//evil.example")));
    expect(location(res)).toBe("https://app.example.test/");
  });

  it("reports a provider error without calling Supabase", async () => {
    const res = await callback(get("/auth/callback?error=access_denied"));
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(location(res)).toBe("https://app.example.test/auth/error?reason=provider");
  });

  it("rejects a callback without a code", async () => {
    expect(location(await callback(get("/auth/callback")))).toMatch(/reason=missing_code$/);
  });

  it("treats a replayed code as success when the first attempt already signed the user in", async () => {
    auth.exchangeCodeForSession.mockResolvedValue(authError);
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: USER_ID, role: "authenticated" } }, error: null });
    const res = await callback(get("/auth/callback?code=used&next=/dashboard"));
    expect(location(res)).toBe("https://app.example.test/dashboard");
  });

  it("fails a bad code when there is no session", async () => {
    auth.exchangeCodeForSession.mockResolvedValue(authError);
    auth.getClaims.mockResolvedValue({ data: null, error: { message: "no session" } });
    expect(location(await callback(get("/auth/callback?code=bad")))).toMatch(/reason=exchange_failed$/);
  });
});

describe("GET /auth/confirm", () => {
  it("verifies a signup link and continues", async () => {
    auth.verifyOtp.mockResolvedValue(ok);
    const res = await confirm(get("/auth/confirm?token_hash=h&type=signup&next=/onboarding"));
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "h" });
    expect(location(res)).toBe("https://app.example.test/onboarding");
  });

  it("sends password recovery to the update-password page regardless of next", async () => {
    auth.verifyOtp.mockResolvedValue(ok);
    const res = await confirm(get("/auth/confirm?token_hash=h&type=recovery&next=https://evil.example"));
    expect(location(res)).toBe("https://app.example.test/auth/update-password");
  });

  it("rejects unknown link types without calling Supabase", async () => {
    const res = await confirm(get("/auth/confirm?token_hash=h&type=admin"));
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(location(res)).toMatch(/reason=invalid_link$/);
  });

  it("reports expired links", async () => {
    auth.verifyOtp.mockResolvedValue(authError);
    expect(location(await confirm(get("/auth/confirm?token_hash=h&type=email")))).toMatch(/reason=link_expired$/);
  });
});

describe("getVerifiedActor", () => {
  const claims = (c: unknown) => auth.getClaims.mockResolvedValue({ data: { claims: c }, error: null });

  it("returns the verified user", async () => {
    claims({ sub: USER_ID, role: "authenticated", email: "a@example.test" });
    expect(await getVerifiedActor()).toMatchObject({ userId: USER_ID, email: "a@example.test" });
  });

  it.each([
    ["anonymous sessions", { sub: USER_ID, role: "authenticated", is_anonymous: true }],
    ["non-authenticated roles", { sub: USER_ID, role: "anon" }],
    ["malformed subjects", { sub: "not-a-uuid", role: "authenticated" }],
  ])("rejects %s", async (_label, c) => {
    claims(c);
    expect(await getVerifiedActor()).toBeNull();
  });

  it("returns null when verification fails", async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: { message: "invalid JWT" } });
    expect(await getVerifiedActor()).toBeNull();
  });
});
