import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError, findPgError, handleServiceError, toAppError } from "@/server/errors";
import { redact } from "@/server/log";
import { parseServerEnv } from "@/server/env";

const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });

afterEach(() => vi.restoreAllMocks());

describe("toAppError", () => {
  it("passes ClubSphere procedure messages through as user-facing text", () => {
    const err = toAppError(pgError("CS409", "membership request has already been approved"));
    expect(err).toMatchObject({ code: "CONFLICT", publicMessage: "Membership request has already been approved." });
    expect(err.status).toBe(409);
  });

  it("finds the Postgres error inside Drizzle's wrapper but never uses the wrapper's message", () => {
    const wrapped = new DrizzleQueryError(
      "select private.request_membership($1, $2)",
      ["secret-slug", '{"phone":"555-0100"}'],
      pgError("23505", 'duplicate key value violates unique constraint "x"'),
    );
    expect(findPgError(wrapped)?.code).toBe("23505");
    const err = toAppError(wrapped);
    expect(err).toMatchObject({ code: "CONFLICT", publicMessage: "That already exists." });
    expect(err.publicMessage).not.toMatch(/select|555|secret/);
  });

  it.each([
    ["42501", "FORBIDDEN"],
    ["23514", "INVALID_INPUT"],
    ["40001", "CONFLICT"],
    ["08006", "UNAVAILABLE"],
    ["XX000", "INTERNAL"],
  ])("maps SQLSTATE %s to %s", (code, expected) => {
    expect(toAppError(pgError(code, "internal detail")).code).toBe(expected);
  });

  it("hides unexpected errors behind a generic message", () => {
    const err = toAppError(new TypeError("Cannot read properties of undefined (reading 'id') at /srv/app.js:12"));
    expect(err).toMatchObject({ code: "INTERNAL", publicMessage: "Something went wrong. Please try again." });
  });

  it("reports the first Zod issue with its field path", () => {
    const result = z.object({ requestId: z.uuid() }).safeParse({ requestId: "nope" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toAppError(result.error)).toMatchObject({ code: "INVALID_INPUT", publicMessage: expect.stringMatching(/^requestId: /) });
    }
  });

  it("returns AppErrors unchanged", () => {
    const original = new AppError("NOT_FOUND", "Nope.");
    expect(toAppError(original)).toBe(original);
  });
});

describe("handleServiceError logging", () => {
  it("logs codes, never SQL or parameters", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    handleServiceError(
      "membership.review",
      new DrizzleQueryError("select secret_stuff($1)", ["person@example.test"], pgError("XX000", "boom")),
    );
    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ level: "error", event: "service.failed", operation: "membership.review", pgCode: "XX000" });
    expect(line).not.toMatch(/secret_stuff|person@example/);
  });
});

describe("redact", () => {
  it("removes credential-like keys at any depth", () => {
    expect(
      redact({
        user: "u1",
        password: "hunter2",
        nested: { Authorization: "Bearer x", cookie: "sb=1", list: [{ refresh_token: "r" }] },
        serviceRoleKey: "k",
      }),
    ).toEqual({
      user: "u1",
      password: "[redacted]",
      nested: { Authorization: "[redacted]", cookie: "[redacted]", list: [{ refresh_token: "[redacted]" }] },
      serviceRoleKey: "[redacted]",
    });
  });
});

describe("parseServerEnv", () => {
  it("applies safe defaults", () => {
    expect(parseServerEnv({ DATABASE_URL: "postgresql://u:p@localhost:6543/postgres" })).toMatchObject({
      APP_ENV: "development",
      DATABASE_POOL_MAX: 5,
      LOG_LEVEL: "info",
    });
  });

  it("names invalid variables without echoing their values", () => {
    expect(() => parseServerEnv({ DATABASE_URL: "mysql://u:sup3rsecret@h/db" })).toThrow(/DATABASE_URL/);
    expect(() => parseServerEnv({ DATABASE_URL: "mysql://u:sup3rsecret@h/db" })).not.toThrow(/sup3rsecret/);
  });
});
