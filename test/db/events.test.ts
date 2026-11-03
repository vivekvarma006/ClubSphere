import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthUser, freshWorld, joinOrg, type World } from "./fixtures";
import { asUser, pgError, scalar } from "./harness";

let db: PGlite;
let w: World;

beforeEach(async () => {
  ({ db, w } = await freshWorld());
});

interface EventOptions {
  status?: string;
  capacity?: number | null;
  startsInHours?: number;
}

/** Creates an event as `actor` through RLS (needs event.manage). */
async function createEvent(actor: string, orgId: string, opts: EventOptions = {}): Promise<string> {
  const start = opts.startsInHours ?? 24;
  return asUser(db, actor, (tx) =>
    scalar<string>(
      tx,
      `insert into public.events (organization_id, title, starts_at, ends_at, capacity, status)
       values ($1, 'Intro workshop', now() + make_interval(hours => $2), now() + make_interval(hours => $2 + 2), $3, $4)
       returning id as v`,
      [orgId, start, opts.capacity ?? null, opts.status ?? "published"],
    ),
  );
}

const register = (userId: string, eventId: string) =>
  asUser(db, userId, (tx) => scalar<string>(tx, "select private.register_for_event($1) as v", [eventId]));

const tokenOf = (userId: string, registrationId: string) =>
  asUser(db, userId, (tx) =>
    scalar<string>(tx, "select token as v from public.registration_credentials where registration_id = $1", [registrationId]),
  );

const checkIn = (scanner: string, eventId: string, token: string) =>
  asUser(db, scanner, (tx) =>
    scalar<{ status: string; display_name: string }>(tx, "select private.check_in($1, $2) as v", [eventId, token]),
  );

describe("managing events", () => {
  it("officers create events in their own organization only", async () => {
    await expect(createEvent(w.officerA, w.orgA.id)).resolves.toBeTypeOf("string");
    expect((await pgError(createEvent(w.officerA, w.orgB.id))).code).toBe("42501");
    expect((await pgError(createEvent(w.memberA, w.orgA.id))).code).toBe("42501");
  });

  it("rejects impossible events at the database level", async () => {
    const err = await pgError(
      asUser(db, w.officerA, (tx) =>
        tx.query(
          "insert into public.events (organization_id, title, starts_at, ends_at) values ($1, 'Backwards', now(), now() - interval '1 hour')",
          [w.orgA.id],
        ),
      ),
    );
    expect(err.code).toBe("23514");
  });

  it("hides drafts from members and other organizations' events from everyone", async () => {
    await createEvent(w.officerA, w.orgA.id, { status: "draft" });
    await createEvent(w.officerA, w.orgA.id, { status: "published" });
    await createEvent(w.officerB, w.orgB.id, { status: "published" });

    const seen = async (actor: string) =>
      (await asUser(db, actor, (tx) => tx.query<{ status: string; organization_id: string }>("select status, organization_id from public.events"))).rows;

    expect((await seen(w.memberA)).map((r) => r.status)).toEqual(["published"]);
    expect(await seen(w.officerA)).toHaveLength(2);
    expect((await seen(w.memberB)).every((r) => r.organization_id === w.orgB.id)).toBe(true);
  });

  it("records who created an event from the session, not from input", async () => {
    const id = await createEvent(w.officerA, w.orgA.id);
    expect(await scalar<string>(db, "select created_by as v from public.events where id = $1", [id])).toBe(w.officerA);
  });
});

describe("registering", () => {
  it("issues a private 64-character QR token on registration", async () => {
    const eventId = await createEvent(w.officerA, w.orgA.id);
    const regId = await register(w.memberA, eventId);
    expect(await tokenOf(w.memberA, regId)).toMatch(/^[0-9a-f]{64}$/);

    // Nobody else can read it, not even the officer who runs the event.
    for (const other of [w.officerA, w.ownerA, w.crossUser]) {
      const rows = await asUser(db, other, (tx) =>
        tx.query("select token from public.registration_credentials where registration_id = $1", [regId]),
      );
      expect(rows.rows).toEqual([]);
    }
  });

  it("is idempotent", async () => {
    const eventId = await createEvent(w.officerA, w.orgA.id);
    expect(await register(w.memberA, eventId)).toBe(await register(w.memberA, eventId));
  });

  it("is only for active members of the organizing club", async () => {
    const eventId = await createEvent(w.officerA, w.orgA.id);
    expect((await pgError(register(w.memberB, eventId))).code).toBe("CS404");
    expect((await pgError(register(w.applicant, eventId))).code).toBe("CS404");
  });

  it("refuses drafts and finished events", async () => {
    const draft = await createEvent(w.officerA, w.orgA.id, { status: "draft" });
    expect((await pgError(register(w.officerA, draft))).code).toBe("CS409");
    const past = await createEvent(w.officerA, w.orgA.id, { startsInHours: -10 });
    expect((await pgError(register(w.memberA, past))).message).toMatch(/already ended/);
  });

  it("never exceeds capacity, and a cancellation frees the seat", async () => {
    const eventId = await createEvent(w.officerA, w.orgA.id, { capacity: 2 });
    await register(w.memberA, eventId);
    const officerReg = await register(w.officerA, eventId);
    expect((await pgError(register(w.crossUser, eventId))).message).toMatch(/full/);

    await asUser(db, w.officerA, (tx) => tx.query("select private.cancel_registration($1)", [officerReg]));
    await expect(register(w.crossUser, eventId)).resolves.toBeTypeOf("string");
  });

  it("lets only the registrant cancel", async () => {
    const eventId = await createEvent(w.officerA, w.orgA.id);
    const regId = await register(w.memberA, eventId);
    const err = await pgError(asUser(db, w.officerA, (tx) => tx.query("select private.cancel_registration($1)", [regId])));
    expect(err.code).toBe("CS404");
  });
});

describe("QR check-in", () => {
  let eventId: string;
  let regId: string;
  let token: string;

  beforeEach(async () => {
    eventId = await createEvent(w.officerA, w.orgA.id);
    regId = await register(w.memberA, eventId);
    token = await tokenOf(w.memberA, regId);
  });

  it("checks a participant in exactly once", async () => {
    expect(await checkIn(w.officerA, eventId, token)).toMatchObject({ status: "checked_in", display_name: "member-a" });
    expect(await checkIn(w.officerA, eventId, token)).toMatchObject({ status: "already_checked_in" });
    expect(await scalar<number>(db, "select count(*)::int as v from public.event_attendance where registration_id = $1", [regId])).toBe(1);
  });

  it("works for the volunteer role, which exists only to scan", async () => {
    const volunteer = await createAuthUser(db, { email: "helper@example.test", name: "Helper" });
    await joinOrg(db, w.orgA, volunteer, w.ownerA, "volunteer");
    expect(await checkIn(volunteer, eventId, token)).toMatchObject({ status: "checked_in" });
  });

  it("refuses scanners without event.checkin, and scanners from other clubs", async () => {
    expect((await pgError(checkIn(w.memberA, eventId, token))).code).toBe("CS404");
    expect((await pgError(checkIn(w.officerB, eventId, token))).code).toBe("CS404");
  });

  it("rejects malformed, unknown, wrong-event and other-club codes", async () => {
    expect((await pgError(checkIn(w.officerA, eventId, "not-a-code"))).code).toBe("CS422");
    expect((await pgError(checkIn(w.officerA, eventId, "f".repeat(64)))).code).toBe("CS404");

    const otherEvent = await createEvent(w.officerA, w.orgA.id);
    expect((await pgError(checkIn(w.officerA, otherEvent, token))).message).toMatch(/different event/);

    const eventB = await createEvent(w.officerB, w.orgB.id);
    const tokenB = await tokenOf(w.memberB, await register(w.memberB, eventB));
    expect((await pgError(checkIn(w.officerA, eventId, tokenB))).message).toBe("QR code not recognised");
  });

  it("rejects cancelled registrations and cancelled events", async () => {
    await asUser(db, w.memberA, (tx) => tx.query("select private.cancel_registration($1)", [regId]));
    expect((await pgError(checkIn(w.officerA, eventId, token))).message).toMatch(/cancelled/);

    await asUser(db, w.memberA, (tx) => tx.query("select private.register_for_event($1)", [eventId]));
    await asUser(db, w.officerA, (tx) => tx.query("update public.events set status = 'cancelled' where id = $1", [eventId]));
    expect((await pgError(checkIn(w.officerA, eventId, token))).message).toMatch(/not open/);
  });

  it("supports manual check-in by event managers only", async () => {
    const manual = (actor: string) =>
      asUser(db, actor, (tx) => scalar<{ status: string }>(tx, "select private.check_in_registration($1) as v", [regId]));
    expect((await pgError(manual(w.memberA))).code).toBe("CS404");
    expect(await manual(w.officerA)).toMatchObject({ status: "checked_in" });
  });

  it("stops a checked-in participant from cancelling", async () => {
    await checkIn(w.officerA, eventId, token);
    const err = await pgError(asUser(db, w.memberA, (tx) => tx.query("select private.cancel_registration($1)", [regId])));
    expect(err.message).toMatch(/already been checked in/);
  });

  it("feeds the attendance report", async () => {
    await register(w.officerA, eventId);
    await checkIn(w.officerA, eventId, token);
    const rows = await asUser(db, w.officerA, (tx) =>
      tx.query("select registered, attended, attendance_rate_pct from public.report_event_attendance where event_id = $1", [eventId]),
    );
    expect(rows.rows).toEqual([{ registered: 2, attended: 1, attendance_rate_pct: "50.0" }]);
  });
});
