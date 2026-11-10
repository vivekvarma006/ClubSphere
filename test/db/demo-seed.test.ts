import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, scalar, asUser } from "./harness";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/server/db/schema";
import { verifiedActor } from "@/server/auth/actor";
import { getMyActivity } from "@/server/services/activity";
import { getEvent } from "@/server/services/events";
import { ensureDemoShowcase } from "@/server/demo/showcase";

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


it("populates My Activity and includes both waiting and promoted demo registrations", async () => {
  const user = (email: string) => scalar<string>(db,"select id as v from public.profiles where email=$1",[email]);
  const app = drizzle(db,{schema});
  const ananya = verifiedActor(await user("ananya@demo.test"),null);
  const activity = await getMyActivity(app,ananya);
  expect(activity.tasks).toMatchObject([{title:"Prepare the security lab"}]);
  expect(activity.certificates).toMatchObject([{title:"Web Exploitation Workshop"}]);
  expect(activity.waitlists).toMatchObject([{title:"Security Lab: Waitlist Demo",position:1}]);
  const rohan = verifiedActor(await user("rohan@demo.test"),null);
  expect((await getMyActivity(app,rohan)).tasks).toMatchObject([{title:"Test the line follower sensors",slug:"robotics"}]);
  const event = await scalar<string>(db,"select id as v from public.events where title='Security Lab: Promoted Place'");
  const detail = await getEvent(app,rohan,"cyber-sec",event);
  expect(detail.waitlist).toEqual({status:"promoted",position:null});
  expect(detail.mine?.token).toMatch(/^[a-f0-9]{64}$/);
});

it("does not recreate fixtures or undo user edits and queue actions on restart", async () => {
  const copy = await db.clone() as PGlite;
  try {
    const before = await scalar<number>(copy,"select count(*)::int as v from public.events");
    await copy.query("update public.volunteer_tasks set title='Edited by the presenter' where title='Prepare the security lab'");
    const ananya=await scalar<string>(copy,"select id as v from public.profiles where email='ananya@demo.test'");
    const event=await scalar<string>(copy,"select id as v from public.events where title='Security Lab: Waitlist Demo'");
    await asUser(copy,ananya,tx => tx.query("select private.leave_event_waitlist($1)",[event]));
    await ensureDemoShowcase(copy); await ensureDemoShowcase(copy);
    expect(await scalar(copy,"select count(*)::int as v from public.events")).toBe(before);
    expect(await scalar(copy,"select count(*)::int as v from public.volunteer_tasks where title='Edited by the presenter'")).toBe(1);
    expect(await scalar(copy,"select status as v from public.event_waitlist where event_id=$1 and user_id=$2",[event,ananya])).toBe("left");
  } finally { await copy.close(); }
});

it("upgrades existing demos additively and respects disabled modules", async () => {
  const copy = await db.clone() as PGlite;
  try {
    // Simulate the previous demo dataset, which had none of these fixtures.
    await copy.exec(`delete from public.task_assignments; delete from public.volunteer_tasks;
      delete from public.certificates;
      delete from public.events where title in ('Security Lab: Waitlist Demo','Security Lab: Promoted Place');
      delete from local_meta.demo_fixtures;
      update public.organizations set settings=jsonb_set(settings,'{features,volunteers}','false') where slug='robotics';`);
    const clubs = await scalar<number>(copy,"select count(*)::int as v from public.organizations");
    const documents = await scalar<number>(copy,"select count(*)::int as v from public.documents");
    await ensureDemoShowcase(copy);
    expect(await scalar(copy,"select count(*)::int as v from public.organizations")).toBe(clubs);
    expect(await scalar(copy,"select count(*)::int as v from public.documents")).toBe(documents);
    expect(await scalar(copy,"select count(*)::int as v from public.event_waitlist where status='waiting'")).toBe(2);
    expect(await scalar(copy,"select count(*)::int as v from public.volunteer_tasks where title='Prepare the security lab'")).toBe(1);
    expect(await scalar(copy,"select count(*)::int as v from public.volunteer_tasks where title='Test the line follower sensors'")).toBe(0);
    expect(await scalar(copy,"select settings->'features'->'volunteers' as v from public.organizations where slug='robotics'")).toBe(false);
  } finally { await copy.close(); }
});

it("refuses to add showcase data outside demo mode", async () => {
  const previous = process.env.AUTH_MODE;
  try {
    process.env.AUTH_MODE = "supabase";
    await expect(ensureDemoShowcase(db)).rejects.toThrow("only available in demo mode");
  } finally {
    process.env.AUTH_MODE = previous;
  }
});
