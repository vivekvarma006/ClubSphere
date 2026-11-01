import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/server/db/client", () => ({ getDb: () => ({ execute }) }));

import { GET } from "@/app/api/health/route";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("health route", () => {
  it("cleans up the deadline after a successful query", async () => {
    execute.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", db: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up the deadline and hides database failures", async () => {
    execute.mockRejectedValue(new Error("postgres://secret@host/database"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", db: "unreachable" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("responds within the deadline when the query is stalled", async () => {
    execute.mockReturnValue(new Promise(() => {}));
    const response = GET();
    await vi.advanceTimersByTimeAsync(2000);
    expect((await response).status).toBe(503);
    expect(vi.getTimerCount()).toBe(0);
  });
});
