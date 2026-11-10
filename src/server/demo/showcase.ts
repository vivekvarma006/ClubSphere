import "server-only";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { isDemoMode } from "@/server/env";

type Person = { id: string; membershipId: string };

async function scalar<T>(tx: Transaction, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await tx.query<{ v: T }>(sql, params);
  if (!rows[0]) throw new Error("Demo showcase query returned no row");
  return rows[0].v;
}

/** A demo-only actor context inside an existing transaction. Never opens a
 * nested PGlite transaction or queries the parent connection from inside one. */
async function asActor<T>(tx: Transaction, user: string, fn: () => Promise<T>): Promise<T> {
  await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
  await tx.exec("set local role authenticated");
  // On failure the outer transaction rolls back the role and claims too.
  const result = await fn();
  await tx.exec("set local role none");
  return result;
}

async function member(tx: Transaction, org: string, handle: string): Promise<Person | undefined> {
  const { rows } = await tx.query<Person>(`
    select p.id,m.id as "membershipId" from public.profiles p
    join public.organization_memberships m on m.user_id=p.id and m.organization_id=$1 and m.status='active'
    join public.organizations o on o.id=m.organization_id and o.status='active'
    where p.email=$2`, [org, `${handle}@demo.test`]);
  return rows[0];
}

/** Additive, versioned fixtures for both fresh and existing local demos.
 * Each fixture commits with its marker, so restarts do not recreate a demo
 * that someone has already completed, cancelled or otherwise changed. */
export async function ensureDemoShowcase(pg: PGlite): Promise<void> {
  if (!isDemoMode()) throw new Error("Demo showcase data is only available in demo mode");
  await pg.exec(`create schema if not exists local_meta;
    create table if not exists local_meta.demo_fixtures (key text primary key, applied_at timestamptz not null default now());`);
  async function once(key: string, fn: (tx: Transaction) => Promise<boolean>) {
    await pg.transaction(async tx => {
      if ((await tx.query("select 1 from local_meta.demo_fixtures where key=$1", [key])).rows.length) return;
      if (await fn(tx)) await tx.query("insert into local_meta.demo_fixtures(key) values($1)", [key]);
    });
  }
  const { rows: clubs } = await pg.query<{ id: string; slug: string }>(
    "select id,slug from public.organizations where slug in ('cyber-sec','robotics') and status='active'");
  for (const club of clubs) {
    const cyber = club.slug === "cyber-sec";
    const managerHandle = cyber ? "sneha" : "farhan";
    await once(`activity-tasks-v1:${club.slug}`, async tx => {
      const manager = await member(tx,club.id,managerHandle);
      const assignee = await member(tx,club.id,cyber ? "ananya" : "rohan");
      if (!manager || !assignee) return false;
      const allowed = await asActor(tx,manager.id,() => scalar<boolean>(tx,
        "select private.module_enabled($1,'volunteers') and private.has_org_permission($1,'task.manage') as v",[club.id]));
      if (!allowed) return false;
      const task = await asActor(tx,manager.id,() => scalar<string>(tx,
        "select private.create_task($1,null,$2,$3,now()+interval '1 day') as v",
        [club.id,cyber ? "Prepare the security lab" : "Test the line follower sensors",
          cyber ? "Check the practice machines and prepare the workshop checklist." : "Check the sensors before the next club practice."]));
      await asActor(tx,manager.id,() => tx.query("select private.assign_task($1,$2,$3)",[club.id,task,assignee.membershipId]));
      if (cyber) {
        const helper = await member(tx,club.id,"kiran");
        if (helper) {
          const completed = await asActor(tx,manager.id,() => scalar<string>(tx,
            "select private.create_task($1,null,'Check workshop materials','Verify the materials from the last workshop.',null) as v",[club.id]));
          await asActor(tx,manager.id,() => tx.query("select private.assign_task($1,$2,$3)",[club.id,completed,helper.membershipId]));
          await asActor(tx,helper.id,() => tx.query("select private.complete_task($1,$2)",[club.id,completed]));
        }
      }
      return true;
    });
    await once(`activity-certificates-v1:${club.slug}`, async tx => {
      const manager = await member(tx,club.id,managerHandle);
      if (!manager) return false;
      const allowed = await asActor(tx,manager.id,() => scalar<boolean>(tx,
        "select private.module_enabled($1,'certificates') and private.has_org_permission($1,'certificate.issue') as v",[club.id]));
      if (!allowed) return false;
      const { rows } = await tx.query<{ id: string }>(
        "select id from public.events where organization_id=$1 and title=$2 and status='completed' order by created_at,id limit 1",
        [club.id,cyber ? "Web Exploitation Workshop" : "Arduino Bootcamp"]);
      if (!rows[0]) return false;
      await asActor(tx,manager.id,() => tx.query("select private.issue_certificates($1,$2)",[club.id,rows[0]!.id]));
      return true;
    });
    if (!cyber) continue;
    await once("activity-waitlists-v1:cyber-sec", async tx => {
      const manager = await member(tx,club.id,"sneha");
      const holder = await member(tx,club.id,"vikram");
      const first = await member(tx,club.id,"ananya");
      const second = await member(tx,club.id,"meera");
      const promoted = await member(tx,club.id,"rohan");
      if (!manager || !holder || !first || !second || !promoted) return false;
      if (!await asActor(tx,manager.id,() => scalar<boolean>(tx,"select private.module_enabled($1,'events') and private.has_org_permission($1,'event.manage') as v",[club.id]))) return false;
      async function event(title: string, description: string) {
        return asActor(tx,manager!.id,() => scalar<string>(tx,`
          insert into public.events(organization_id,title,description,category,venue,starts_at,ends_at,capacity,status)
          values($1,$2,$3,'workshop','Security Lab',now()+interval '2 days',now()+interval '2 days 2 hours',1,'published') returning id as v`,
          [club.id,title,description]));
      }
      const waiting = await event("Security Lab: Waitlist Demo", "One seat, already taken. Ananya and Meera are waiting. Cancel Vikram's registration to promote Ananya automatically.");
      await asActor(tx,holder.id,() => tx.query("select private.register_for_event($1)",[waiting]));
      await asActor(tx,first.id,() => tx.query("select private.join_event_waitlist($1)",[waiting]));
      await asActor(tx,second.id,() => tx.query("select private.join_event_waitlist($1)",[waiting]));
      const example = await event("Security Lab: Promoted Place", "Rohan received this place from the waitlist after another member cancelled. Sign in as Rohan to see the private QR.");
      const registration = await asActor(tx,holder.id,() => scalar<string>(tx,"select private.register_for_event($1) as v",[example]));
      await asActor(tx,promoted.id,() => tx.query("select private.join_event_waitlist($1)",[example]));
      await asActor(tx,holder.id,() => tx.query("select private.cancel_registration($1)",[registration]));
      return true;
    });
  }
}
