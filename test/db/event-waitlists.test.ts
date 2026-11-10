import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshWorld, membershipId, type World } from "./fixtures";
import { asUser, pgError, scalar } from "./harness";

let db: PGlite, w: World, event: string, registration: string;
const join = (user: string) => asUser(db, user, tx => tx.query("select private.join_event_waitlist($1)", [event]));
const leave = (user: string) => asUser(db, user, tx => tx.query("select private.leave_event_waitlist($1)", [event]));
const cancel = () => asUser(db, w.memberA, tx => tx.query("select private.cancel_registration($1)", [registration]));
const register = (user: string) => asUser(db, user, tx => scalar<string>(tx, "select private.register_for_event($1) as v", [event]));
const mine = async (user: string) => (await asUser(db, user, tx => tx.query("select * from private.my_event_waitlist($1)", [event]))).rows;
const registered = async () => (await db.query<{user_id: string}>("select user_id from public.event_registrations where event_id=$1 and status='registered'", [event])).rows.map(r => r.user_id);
beforeEach(async () => {
  ({ db, w } = await freshWorld());
  event = await scalar<string>(db, `insert into public.events(organization_id,title,starts_at,ends_at,capacity,status)
    values($1,'Waitlist workshop',now()+interval '1 day',now()+interval '2 days',1,'published') returning id as v`, [w.orgA.id]);
  registration = await register(w.memberA);
});
afterEach(async () => { await db?.close(); });

describe("event waitlist", () => {
  it("joins idempotently, shows private positions and moves a rejoining member to the back", async () => {
    await join(w.officerA); await join(w.officerA); await join(w.crossUser);
    expect(await mine(w.officerA)).toEqual([{ status: "waiting", queue_position: 1 }]);
    expect(await mine(w.crossUser)).toEqual([{ status: "waiting", queue_position: 2 }]);
    await leave(w.officerA); await leave(w.officerA); await join(w.officerA);
    expect(await mine(w.officerA)).toEqual([{ status: "waiting", queue_position: 2 }]);
    expect(await mine(w.crossUser)).toEqual([{ status: "waiting", queue_position: 1 }]);
  });
  it("promotes in FIFO order and creates only the promoted member's private QR", async () => {
    await join(w.officerA); await join(w.crossUser); await cancel();
    expect(await registered()).toEqual([w.officerA]);
    expect(await mine(w.officerA)).toEqual([{ status: "promoted", queue_position: null }]);
    expect(await mine(w.crossUser)).toEqual([{ status: "waiting", queue_position: 1 }]);
    const tokens = async (user: string) => (await asUser(db, user, tx => tx.query("select token from public.registration_credentials c join public.event_registrations r on r.id=c.registration_id where r.event_id=$1 and r.user_id=$2", [event,w.officerA]))).rows;
    expect(await tokens(w.officerA)).toMatchObject([{ token: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(await tokens(w.ownerA)).toEqual([]);
    await expect(register(w.crossUser)).rejects.toMatchObject({ code: "CS409" });
  });
  it("reuses a cancelled registration on promotion without bypassing capacity", async () => {
    await cancel();
    const other = await register(w.officerA);
    await join(w.memberA);
    await asUser(db, w.officerA, tx => tx.query("select private.cancel_registration($1)", [other]));
    expect(await registered()).toEqual([w.memberA]);
    expect(await register(w.memberA)).toBe(registration);
  });
  it("skips suspended members explicitly and promotes the next eligible person", async () => {
    await join(w.officerA); await join(w.crossUser);
    const membership = await membershipId(db,w.orgA.id,w.officerA);
    await asUser(db, w.ownerA, tx => tx.query("select private.suspend_membership($1,'test')", [membership]));
    await cancel();
    expect(await registered()).toEqual([w.crossUser]);
    expect(await scalar(db,"select status as v from public.event_waitlist where event_id=$1 and user_id=$2",[event,w.officerA])).toBe("ineligible");
  });
  it("promotes when capacity grows and refuses capacity below existing registrations", async () => {
    await join(w.officerA); await join(w.crossUser);
    await asUser(db, w.officerA, tx => tx.query("update public.events set capacity=2 where id=$1", [event]));
    expect(new Set(await registered())).toEqual(new Set([w.memberA,w.officerA]));
    expect((await pgError(asUser(db,w.officerA,tx => tx.query("update public.events set capacity=1 where id=$1", [event])))).code).toBe("CS409");
    await asUser(db,w.officerA,tx => tx.query("update public.events set capacity=null where id=$1", [event]));
    expect(await registered()).toHaveLength(3);
  });
  it("hides other clubs' queues and rejects nonmembers, registrants and direct writes", async () => {
    await join(w.officerA);
    for (const user of [w.memberB,w.applicant]) {
      expect((await pgError(join(user))).code).toBe("CS404");
      expect(await mine(user)).toEqual([]);
      expect((await asUser(db,user,tx => tx.query("select * from public.event_waitlist"))).rows).toEqual([]);
    }
    expect((await pgError(join(w.memberA))).code).toBe("CS409");
    expect((await pgError(asUser(db,w.crossUser,tx => tx.query("update public.event_waitlist set status='promoted'")))).code).toBe("42501");
  });
  it("members see only their own queue entry even within a shared club", async () => {
    await join(w.ownerA);
    expect((await asUser(db,w.memberA,tx => tx.query("select * from public.event_waitlist"))).rows).toEqual([]);
  });
  it("refuses waitlisting when places are available, the event has started or it is a draft", async () => {
    await cancel();
    expect((await pgError(join(w.officerA))).code).toBe("CS409");
    await db.query("update public.events set starts_at=now()-interval '1 hour' where id=$1",[event]);
    expect((await pgError(join(w.officerA))).code).toBe("CS409");
    await db.query("update public.events set starts_at=now()+interval '1 day',status='draft' where id=$1",[event]);
    expect((await pgError(join(w.officerA))).code).toBe("CS409");
  });
  it("closes waiting entries on event cancellation and never promotes them", async () => {
    await join(w.officerA);
    await asUser(db,w.officerA,tx => tx.query("update public.events set status='cancelled' where id=$1",[event]));
    await cancel();
    expect(await registered()).toEqual([]);
    expect(await mine(w.officerA)).toEqual([]);
    expect(await scalar(db,"select status as v from public.event_waitlist where event_id=$1",[event])).toBe("closed");
  });
  it("rolls cancellation back on unexpected promotion failure without dropping the queued member", async () => {
    await join(w.officerA);
    await db.exec(`create function private.fail_waitlist_test() returns trigger language plpgsql as $$ begin raise exception 'unexpected'; end; $$;
      create trigger fail_waitlist_test before insert on public.event_registrations for each row execute function private.fail_waitlist_test();`);
    await expect(cancel()).rejects.toThrow("unexpected");
    expect(await registered()).toEqual([w.memberA]);
    expect(await mine(w.officerA)).toEqual([{ status:"waiting",queue_position:1 }]);
  });
  it("does not promote after the event starts", async () => {
    await join(w.officerA);
    await db.query("update public.events set starts_at=now()-interval '1 hour',capacity=2 where id=$1",[event]);
    expect(await registered()).toEqual([w.memberA]);
    expect(await mine(w.officerA)).toEqual([]);
  });
});
