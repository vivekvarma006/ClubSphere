import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithOAuth: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
import {
  forgotPassword,
  googleLogin,
  login,
  signup,
} from "@/app/login/actions";
const form = (extra: Record<string, string> = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({
    email: "user@example.test",
    password: "test-password",
    ...extra,
  }))
    fd.set(k, v);
  return fd;
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_MODE", "supabase");
  vi.stubEnv("APP_URL", "https://clubs.example.test");
  vi.spyOn(console, "error").mockImplementation(() => {});
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("Supabase sign-in actions", () => {
  it("signs in and normalizes unsafe redirect paths", async () => {
    await expect(
      login(null, form({ next: "/a/..//evil.test" })),
    ).rejects.toThrow("REDIRECT:/dashboard");
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.test",
      password: "test-password",
    });
  });
  it("keeps safe destinations", async () => {
    await expect(
      login(null, form({ next: "/o/example/events" })),
    ).rejects.toThrow("REDIRECT:/o/example/events");
  });
  it("does not expose provider errors or credentials", async () => {
    auth.signInWithPassword.mockRejectedValue(
      new Error("secret test-password"),
    );
    expect(JSON.stringify(await login(null, form()))).not.toMatch(
      /secret|test-password/,
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(
      /secret|test-password/,
    );
  });
  it("validates signup confirmation before contacting Supabase", async () => {
    expect(
      (await signup(null, form({ displayName: "User", confirmation: "other" })))
        ?.ok,
    ).toBe(false);
    expect(auth.signUp).not.toHaveBeenCalled();
  });
  it("sends confirmation with a configured callback and display name", async () => {
    expect(
      (
        await signup(
          null,
          form({ displayName: "User", confirmation: "test-password" }),
        )
      )?.ok,
    ).toBe(true);
    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          data: { full_name: "User" },
          emailRedirectTo:
            "https://clubs.example.test/auth/callback?next=%2Fdashboard",
        },
      }),
    );
  });
  it("returns the same recovery response for missing users and provider rejections", async () => {
    const success = await forgotPassword(null, form());
    auth.resetPasswordForEmail.mockResolvedValue({
      error: { message: "not found" },
    });
    expect(await forgotPassword(null, form())).toEqual(success);
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "user@example.test",
      {
        redirectTo:
          "https://clubs.example.test/auth/callback?next=%2Fauth%2Fupdate-password",
      },
    );
  });
  it("initiates Google OAuth with a safe return path", async () => {
    auth.signInWithOAuth.mockResolvedValue({
      data: { url: "https://provider.example.test/oauth" },
      error: null,
    });
    await expect(
      googleLogin(null, form({ next: "//evil.test" })),
    ).rejects.toThrow("REDIRECT:https://provider.example.test/oauth");
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo:
          "https://clubs.example.test/auth/callback?next=%2Fdashboard",
      },
    });
  });
  it("rejects malformed input and demo-mode calls", async () => {
    expect((await login(null, form({ email: "invalid" })))?.ok).toBe(false);
    vi.stubEnv("AUTH_MODE", "demo");
    for (const action of [login, signup, forgotPassword, googleLogin])
      expect((await action(null, form()))?.ok).toBe(false);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});
