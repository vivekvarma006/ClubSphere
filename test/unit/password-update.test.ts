import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getClaims: vi.fn(), updateUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth }) }));

import { updatePassword } from "@/app/auth/update-password/actions";

const initial = { status: "idle" as const, message: "" };
const password = "new-password-for-testing";
const submit = (value: unknown = password, confirmation: unknown = value) => {
  const data = new FormData();
  if (typeof value === "string") data.set("password", value);
  if (typeof confirmation === "string") data.set("confirmation", confirmation);
  return updatePassword(initial, data);
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  auth.getClaims.mockResolvedValue({
    data: { claims: { sub: "8f9c2f4e-3b1a-4c55-9d1e-2b7a6c0d1e2f", role: "authenticated" } }, error: null,
  });
  auth.updateUser.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => vi.restoreAllMocks());

describe("password update action", () => {
  it("updates the verified user's password without returning it", async () => {
    const state = await submit();
    expect(auth.updateUser).toHaveBeenCalledWith({ password });
    expect(state.status).toBe("success");
    expect(JSON.stringify(state)).not.toContain(password);
  });

  it("rechecks authentication even when invoked directly", async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: { message: "expired" } });
    expect((await submit()).message).toContain("session has expired");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it.each([["short", "short"], [password, "different"], ["x".repeat(129), "x".repeat(129)], [null, null]])(
    "rejects invalid password input %#", async (value, confirmation) => {
      expect((await submit(value, confirmation)).status).toBe("error");
      expect(auth.updateUser).not.toHaveBeenCalled();
    },
  );

  it("rejects anonymous sessions", async () => {
    auth.getClaims.mockResolvedValue({
      data: { claims: { sub: "8f9c2f4e-3b1a-4c55-9d1e-2b7a6c0d1e2f", role: "authenticated", is_anonymous: true } }, error: null,
    });
    expect((await submit()).status).toBe("error");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("hides provider details from responses and logs", async () => {
    auth.updateUser.mockResolvedValue({ error: { code: "unexpected", status: 500, message: `secret: ${password}` } });
    const state = await submit();
    expect(state.status).toBe("error");
    expect(JSON.stringify([state, vi.mocked(console.log).mock.calls])).not.toMatch(/secret:|new-password-for-testing/);
  });

  it("handles network failures without exposing details", async () => {
    auth.updateUser.mockRejectedValue(new Error(`secret: ${password}`));
    const state = await submit();
    expect(state.message).toContain("temporarily unavailable");
    expect(JSON.stringify([state, vi.mocked(console.error).mock.calls])).not.toMatch(/secret:|new-password-for-testing/);
  });
});
