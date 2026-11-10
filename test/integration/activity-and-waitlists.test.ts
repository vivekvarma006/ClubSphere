import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { verifiedActor } from "@/server/auth/actor";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { getMyActivity } from "@/server/services/activity";
import { changeEventWaitlist, getEvent } from "@/server/services/events";
import { asUser, scalar } from "../db/harness";
import { freshWorld, membershipId, type World } from "../db/fixtures";

let pg: PGlite, db: Database, w: World, event: string;
const actor = (id: string) => verifiedActor(id,null);
beforeEach(async () => {
  ({db:pg,w} = await freshWorld()); db=drizzle(pg,{schema});
  await pg.exec(`update public.organizations set settings='{"features":{"volunteers":true,"certificates":true}}'`);
  event=await scalar(pg,`insert into public.events(organization_id,title,starts_at,ends_at,capacity,status)
    values($1,'Activity workshop',now()+interval '1 day',now()+interval '2 days',1,'published') returning id as v`,[w.orgA.id]);
  await asUser(pg,w.memberA,tx => tx.query("select private.register_for_event($1)",[event]));
});
afterEach(async () => {await pg?.close();});

async function seedPersonalActivity(user: string) {
  const membership=await membershipId(pg,w.orgA.id,user);
  const task=await scalar(pg,"insert into public.volunteer_tasks(organization_id,title,due_at) values($1,'Your assigned task',now()+interval '1 day') returning id as v",[w.orgA.id]);
  await pg.query("insert into public.task_assignments(organization_id,task_id,membership_id) values($1,$2,$3)",[w.orgA.id,task,membership]);
  const past=await scalar<string>(pg,`insert into public.events(organization_id,title,starts_at,ends_at,status)
    values($1,'Past participation',now()-interval '2 days',now()-interval '1 day','completed') returning id as v`,[w.orgA.id]);
  const registration=await scalar<string>(pg,"insert into public.event_registrations(organization_id,event_id,user_id) values($1,$2,$3) returning id as v",[w.orgA.id,past,user]);
  await pg.query("insert into public.event_attendance(organization_id,event_id,registration_id) values($1,$2,$3)",[w.orgA.id,past,registration]);
  await pg.query(`insert into public.certificates(organization_id,event_id,registration_id,user_id,recipient_name,event_title,organization_name)
    values($1,$2,$3,$4,'Recipient','Past participation','Alpha Society')`,[w.orgA.id,past,registration,user]);
  return task;
}

it("returns personal tasks, certificates and participation with correct dates and totals",async () => {
  await seedPersonalActivity(w.crossUser);
  await changeEventWaitlist(db,actor(w.crossUser),{organizationSlug:w.orgA.slug,eventId:event,operation:"join"});
  const activity=await getMyActivity(db,actor(w.crossUser));
  expect(activity.stats).toEqual({upcoming:0,pendingTasks:1,certificates:1,attended:1});
  expect(activity.tasks).toMatchObject([{title:"Your assigned task",dueAt:expect.any(Date),slug:w.orgA.slug}]);
  expect(activity.certificates).toMatchObject([{title:"Past participation",code:expect.stringMatching(/^[a-f0-9]{64}$/)}]);
  expect(activity.recent).toMatchObject([{checkedInAt:expect.any(Date)}]);
  expect(activity.waitlists).toMatchObject([{id:event,position:1}]);
});
it("officers see only their own personal activity despite broader management visibility",async () => {
  await seedPersonalActivity(w.memberA);
  const activity=await getMyActivity(db,actor(w.officerA));
  expect(activity.stats).toEqual({upcoming:0,pendingTasks:0,certificates:0,attended:0});
  expect(activity.tasks).toEqual([]);expect(activity.certificates).toEqual([]);expect(activity.recent).toEqual([]);
  const other=await getMyActivity(db,actor(w.memberB));
  expect(other.tasks).toEqual([]);expect(other.recent).toEqual([]);
});
it("hides disabled modules and suspended memberships in personal activity",async () => {
  await seedPersonalActivity(w.memberA);
  await pg.query("update public.organizations set settings='{}' where id=$1",[w.orgA.id]);
  expect((await getMyActivity(db,actor(w.memberA))).stats).toEqual({upcoming:1,pendingTasks:0,certificates:0,attended:1});
  const membership=await membershipId(pg,w.orgA.id,w.memberA);
  await asUser(pg,w.ownerA,tx => tx.query("select private.suspend_membership($1,'test')",[membership]));
  const hidden=await getMyActivity(db,actor(w.memberA));
  expect(hidden.stats).toEqual({upcoming:0,pendingTasks:0,certificates:0,attended:0});
  expect(hidden.recent).toEqual([]);
});
it("hides activity for suspended organizations",async () => {
  await seedPersonalActivity(w.memberA);
  await pg.query("update public.organizations set status='suspended' where id=$1",[w.orgA.id]);
  const hidden=await getMyActivity(db,actor(w.memberA));
  expect(hidden.stats).toEqual({upcoming:0,pendingTasks:0,certificates:0,attended:0});
  expect(hidden.recent).toEqual([]);
});
it("prevents event replay under another club slug and exposes a promotion through the real services",async () => {
  await expect(changeEventWaitlist(db,actor(w.crossUser),{organizationSlug:w.orgB.slug,eventId:event,operation:"join"})).rejects.toMatchObject({code:"NOT_FOUND"});
  await changeEventWaitlist(db,actor(w.crossUser),{organizationSlug:w.orgA.slug,eventId:event,operation:"join"});
  expect((await getEvent(db,actor(w.crossUser),w.orgA.slug,event)).waitlist).toEqual({status:"waiting",position:1});
  const registration=await scalar<string>(pg,"select id as v from public.event_registrations where event_id=$1",[event]);
  await asUser(pg,w.memberA,tx => tx.query("select private.cancel_registration($1)",[registration]));
  const detail=await getEvent(db,actor(w.crossUser),w.orgA.slug,event);
  expect(detail.waitlist?.status).toBe("promoted");expect(detail.mine?.token).toMatch(/^[a-f0-9]{64}$/);
  expect((await getMyActivity(db,actor(w.crossUser))).stats.upcoming).toBe(1);
  expect((await getMyActivity(db,actor(w.crossUser))).waitlists).toEqual([]);
});
it("removes completed tasks from next steps",async () => {
  const task=await seedPersonalActivity(w.memberA);
  await asUser(pg,w.memberA,tx => tx.query("select private.complete_task($1,$2)",[w.orgA.id,task]));
  expect((await getMyActivity(db,actor(w.memberA))).stats.pendingTasks).toBe(0);
  expect((await getMyActivity(db,actor(w.memberA))).tasks).toEqual([]);
});
