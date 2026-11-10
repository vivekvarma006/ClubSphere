import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifiedActor } from "@/server/auth/actor";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { getContributionReport } from "@/server/services/contribution-report";
import { freshWorld, type World } from "../db/fixtures";

const cache = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/server/cache/reports", () => ({
  readReportCache: vi.fn(async (key: string) => cache.get(key) ?? null),
  writeReportCache: vi.fn(async (key: string, value: unknown) => { cache.set(key, value); }),
}));
let pg: PGlite, db: Database, w: World;
beforeEach(async () => {
  cache.clear();
  ({ db: pg, w } = await freshWorld());
  db = drizzle(pg, { schema });
  await pg.exec(`update public.organizations set settings='{"features":{"analytics":true}}'`);
});
afterEach(async () => { await pg?.close(); });

it("reports zero-contribution members and serves a scoped snapshot on repeat reads", async () => {
  const report = await getContributionReport(db, verifiedActor(w.officerA, null), w.orgA.slug);
  expect(report.source).toBe("postgresql");
  expect(report.summary).toEqual({ members: 4, contributors: 0, inactive: 4,
    attendance: 0, tasks: 0, ctfPoints: 0, certificates: 0 });
  expect(report.members).toHaveLength(4);
  expect(report.members.every((m) => m.rank === 1)).toBe(true);
  expect((await getContributionReport(db, verifiedActor(w.officerA, null), w.orgA.slug)).source).toBe("redis");
  const other = await getContributionReport(db, verifiedActor(w.officerB, null), w.orgB.slug);
  expect(other.source).toBe("postgresql");
  expect(other.members.some((m) => m.userId === w.memberA)).toBe(false);
});

it("checks live membership and module settings even with a warm cache", async () => {
  const actor = verifiedActor(w.officerA, null);
  await getContributionReport(db, actor, w.orgA.slug);
  await expect(getContributionReport(db, verifiedActor(w.memberA, null), w.orgA.slug)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(getContributionReport(db, verifiedActor(w.officerB, null), w.orgA.slug)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await pg.query(`update public.organizations set settings='{}' where id=$1`, [w.orgA.id]);
  await expect(getContributionReport(db, actor, w.orgA.slug)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await pg.query(`update public.organizations set settings='{"features":{"analytics":true}}' where id=$1`, [w.orgA.id]);
  await pg.query(`update public.organization_memberships set status='suspended', suspended_at=now(), suspended_by=$2, suspension_reason='Test' where organization_id=$1 and user_id=$2`, [w.orgA.id, w.officerA]);
  await expect(getContributionReport(db, actor, w.orgA.slug)).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("refuses unauthorized direct SQL routine calls", async () => {
  // The SQL routine itself also refuses unauthorized direct execution.
  const { asUser, pgError } = await import("../db/harness");
  expect((await pgError(asUser(pg, w.memberA, (tx) => tx.query(
    "select private.contribution_report($1)", [w.orgA.id])))).code).toBe("CS403");
});
