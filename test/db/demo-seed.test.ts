import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, scalar } from "./harness";

// The demo seed acts through the real procedures, so if any rule rejects a
// seeded action this test fails before a live demo does.
let db: PGlite;

beforeAll(async () => {
  process.env.AUTH_MODE = "demo";
  process.env.EMBEDDINGS_PROVIDER = "hash"; // no model files needed in CI
  const { seedDemoData } = await import("@/server/demo/seed");
  db = await freshDb();
  await seedDemoData(db);
});

describe("demo seed", () => {
  it("creates both clubs with members, applicants and history", async () => {
    const rows = await db.query<{ slug: string; active: number; pending: number }>(
      `select o.slug,
              (select count(*)::int from public.organization_memberships m where m.organization_id = o.id and m.status = 'active') as active,
              (select count(*)::int from public.membership_requests r where r.organization_id = o.id and r.status = 'pending') as pending
         from public.organizations o order by o.slug`,
    );
    expect(rows.rows).toEqual([
      { slug: "cyber-sec", active: 7, pending: 2 },
      { slug: "robotics", active: 5, pending: 1 },
    ]);
  });

  it("has a live event with some participants already checked in", async () => {
    const live = await db.query<{ registered: number; attended: number }>(
      `select (select count(*)::int from public.event_registrations r where r.event_id = e.id and r.status = 'registered') as registered,
              (select count(*)::int from public.event_attendance a where a.event_id = e.id) as attended
         from public.events e where e.title = 'CyberQuest CTF 2026'`,
    );
    expect(live.rows).toEqual([{ registered: 5, attended: 2 }]);
  });

  it("indexes every demo document for search", async () => {
    expect(await scalar<number>(db, "select count(*)::int as v from public.documents")).toBe(12);
    expect(await scalar<number>(db, "select count(distinct embedding_model)::int as v from public.document_chunks")).toBe(1);
  });

  it("attributes every user action in the audit trail; only seed bootstrap steps have no actor", async () => {
    const { rows } = await db.query<{ action: string }>(
      "select distinct action from public.audit_logs where actor_id is null order by action",
    );
    // Bootstrap (making the platform admin) and back-dating past activity are
    // done directly as the database owner, exactly as an operator would.
    const allowed = new Set([
      "platform_admin.created",
      "event.status_changed",
      "event.updated",
      "event_registration.updated",
      "attendance.updated",
      "membership_request.updated",
    ]);
    expect(rows.map((r) => r.action).filter((a) => !allowed.has(a))).toEqual([]);
  });
});
