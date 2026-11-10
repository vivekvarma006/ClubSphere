import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { readReportCache, writeReportCache, REPORT_TTL_SECONDS } from "@/server/cache/reports";

afterEach(() => vi.unstubAllEnvs());
it("falls back without Redis configuration", async () => {
  vi.stubEnv("REDIS_URL", "");
  expect(await readReportCache("unused", z.object({ value: z.number() }))).toBeNull();
  await writeReportCache("unused", { value: 1 });
});
it.skipIf(!process.env.TEST_REDIS_URL)("stores real Redis snapshots with TTL and rejects corrupt values", async () => {
  vi.stubEnv("REDIS_URL", process.env.TEST_REDIS_URL!);
  const key = `clubsphere:test:${randomUUID()}`;
  const client = createClient({ url: process.env.TEST_REDIS_URL,
    socket: { connectTimeout: 1000, reconnectStrategy: false } });
  client.on("error", () => {});
  await client.connect();
  try {
    const shape = z.object({ value: z.number() });
    expect(await readReportCache(key, shape)).toBeNull();
    await writeReportCache(key, { value: 42 });
    expect(await readReportCache(key, shape)).toEqual({ value: 42 });
    expect(await client.ttl(key)).toBeGreaterThan(0);
    expect(await client.ttl(key)).toBeLessThanOrEqual(REPORT_TTL_SECONDS);
    await client.set(key, '{broken', { EX: 30 });
    expect(await readReportCache(key, shape)).toBeNull();
    await client.set(key, '{"value":"wrong"}', { EX: 30 });
    expect(await readReportCache(key, shape)).toBeNull();
  } finally { await client.del(key); client.destroy(); }
});

it.skipIf(!process.env.TEST_REDIS_URL)("serves a PostgreSQL contribution report from real Redis on its second read", async () => {
  vi.stubEnv("REDIS_URL", process.env.TEST_REDIS_URL!);
  vi.stubEnv("REDIS_KEY_PREFIX", `clubsphere:test:${randomUUID()}`);
  const { freshWorld } = await import("../db/fixtures");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/server/db/schema");
  const { verifiedActor } = await import("@/server/auth/actor");
  const { getContributionReport } = await import("@/server/services/contribution-report");
  const { db: pg, w } = await freshWorld();
  try {
    await pg.exec(`update public.organizations set settings='{"features":{"analytics":true}}'`);
    const db = drizzle(pg, { schema });
    const actor = verifiedActor(w.officerA, null);
    const first = await getContributionReport(db, actor, w.orgA.slug);
    const second = await getContributionReport(db, actor, w.orgA.slug);
    expect(first.source).toBe("postgresql");
    expect(second.source).toBe("redis");
    expect(second.members).toEqual(first.members);
    expect(second.summary).toEqual(first.summary);
  } finally { await pg.close(); }
});
