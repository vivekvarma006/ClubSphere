import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshWorld, membershipId, type World } from "./fixtures";
import { asAnon, asUser, pgError, scalar } from "./harness";

let db: PGlite,
  w: World,
  event: string,
  item: string,
  slot: string,
  registration: string,
  token: string;
const call = <T = unknown>(
  actor: string,
  query: string,
  values: unknown[] = [],
) => asUser(db, actor, (tx) => scalar<T>(tx, query, values));
const exec = (actor: string, query: string, values: unknown[] = []) =>
  asUser(db, actor, (tx) => tx.query(query, values));
const count = (table: string) =>
  scalar<number>(db, `select count(*)::int as v from public.${table}`);

beforeEach(async () => {
  ({ db, w } = await freshWorld());
  await db.exec(
    `update public.organizations set settings='{"features":{"inventory":true,"volunteers":true,"ctf":true,"certificates":true,"feedback":true,"analytics":true}}'`,
  );
  event = await scalar<string>(
    db,
    `insert into public.events(organization_id,title,category,starts_at,ends_at,status) values($1,'Product workshop','ctf',now()-interval '1 hour',now()+interval '1 hour','published') returning id as v`,
    [w.orgA.id],
  );
  // Register while the event is open, and check in through the actual scanner procedure.
  registration = await call<string>(
    w.memberA,
    "select private.register_for_event($1) as v",
    [event],
  );
  token = await call<string>(
    w.memberA,
    "select token as v from public.registration_credentials where registration_id=$1",
    [registration],
  );
  item = await call<string>(
    w.officerA,
    "select private.adjust_inventory($1,null,'Lunch',2,'Initial supply') as v",
    [w.orgA.id],
  );
  slot = await call<string>(
    w.officerA,
    "select private.create_meal_slot($1,$2,$3,'Lunch') as v",
    [w.orgA.id, event, item],
  );
});
afterEach(async () => {
  await db?.close();
});
const checkIn = () =>
  call(w.officerA, "select private.check_in($1,$2) as v", [event, token]);
const claim = (actor = w.officerA, selectedSlot = slot) =>
  call<{ status: string }>(actor, "select private.claim_meal($1,$2,$3) as v", [
    event,
    selectedSlot,
    token,
  ]);
const quantity = () =>
  scalar<number>(
    db,
    "select quantity as v from public.inventory_items where id=$1",
    [item],
  );
const task = () =>
  call<string>(
    w.officerA,
    "select private.create_task($1,$2,'Set up venue','Chairs and projector',null) as v",
    [w.orgA.id, event],
  );
const challenge = () =>
  call<string>(
    w.officerA,
    "select private.create_challenge($1,$2,'Example challenge','Find the flag',100,'flag{secret}') as v",
    [w.orgA.id, event],
  );
const chunks = JSON.stringify([
  {
    content: "Useful event feedback",
    embedding: Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0)),
  },
]);
const feedback = (actor = w.memberA, rating = 5) =>
  call(
    actor,
    "select private.submit_feedback($1,$2,$3,'Useful event feedback','test-model',$4::jsonb) as v",
    [w.orgA.id, event, rating, chunks],
  );

describe("food and inventory invariants", () => {
  it("requires attendance before a meal can be claimed", async () => {
    expect((await pgError(claim())).code).toBe("CS404");
    expect(await quantity()).toBe(2);
    expect(await count("food_claims")).toBe(0);
  });
  it("deducts exactly one unit and keeps repeated scans idempotent", async () => {
    await checkIn();
    expect((await claim()).status).toBe("claimed");
    expect((await claim()).status).toBe("already_claimed");
    expect(await quantity()).toBe(1);
    expect(await count("food_claims")).toBe(1);
    expect(await count("stock_movements")).toBe(2);
  });
  it("rolls back both claim and movement if stock is exhausted", async () => {
    await checkIn();
    await call(
      w.officerA,
      "select private.adjust_inventory($1,$2,null,-2,'Correction') as v",
      [w.orgA.id, item],
    );
    expect((await pgError(claim())).code).toBe("23514");
    expect(await quantity()).toBe(0);
    expect(await count("food_claims")).toBe(0);
    expect(await count("stock_movements")).toBe(2);
  });
  it("rejects missing permissions, cross-club actors, and foreign item IDs", async () => {
    await checkIn();
    for (const actor of [w.memberA, w.officerB, w.applicant])
      expect((await pgError(claim(actor))).code).toBe("CS404");
    expect(
      (
        await pgError(
          call(
            w.officerB,
            "select private.create_meal_slot($1,$2,$3,'Other meal') as v",
            [w.orgB.id, event, item],
          ),
        )
      ).code,
    ).toBe("23503");
    expect(
      (
        await pgError(
          exec(
            w.officerA,
            "update public.inventory_items set quantity=100 where id=$1",
            [item],
          ),
        )
      ).code,
    ).toBe("42501");
  });
  it("hides stock from plain members and other clubs", async () => {
    for (const actor of [w.memberA, w.officerB])
      expect(
        (await exec(actor, "select * from public.inventory_items")).rows,
      ).toEqual([]);
  });
});
describe("volunteer assignments", () => {
  it("allows only the assigned member to complete, without changing completion on replay", async () => {
    const id = await task(),
      membership = await membershipId(db, w.orgA.id, w.memberA);
    await call(w.officerA, "select private.assign_task($1,$2,$3) as v", [
      w.orgA.id,
      id,
      membership,
    ]);
    expect(
      (
        await pgError(
          call(w.crossUser, "select private.complete_task($1,$2) as v", [
            w.orgA.id,
            id,
          ]),
        )
      ).code,
    ).toBe("CS404");
    await call(w.memberA, "select private.complete_task($1,$2) as v", [
      w.orgA.id,
      id,
    ]);
    const first = await scalar<string>(
      db,
      "select completed_at::text as v from public.task_assignments where task_id=$1",
      [id],
    );
    await call(w.memberA, "select private.complete_task($1,$2) as v", [
      w.orgA.id,
      id,
    ]);
    expect(
      await scalar(
        db,
        "select completed_at::text as v from public.task_assignments where task_id=$1",
        [id],
      ),
    ).toBe(first);
  });
  it("rejects assignments across clubs and creation without task.manage", async () => {
    const id = await task();
    expect(
      (
        await pgError(
          call(w.officerA, "select private.assign_task($1,$2,$3) as v", [
            w.orgA.id,
            id,
            await membershipId(db, w.orgB.id, w.memberB),
          ]),
        )
      ).code,
    ).toBe("CS404");
    expect(
      (
        await pgError(
          call(
            w.memberA,
            "select private.create_task($1,null,'No permission','',null) as v",
            [w.orgA.id],
          ),
        )
      ).code,
    ).toBe("CS404");
  });
});
describe("CTF", () => {
  it("never grants flag-hash reads or records submitted plaintext", async () => {
    await challenge();
    expect(
      (
        await pgError(
          exec(w.officerA, "select flag_hash from public.ctf_challenges"),
        )
      ).code,
    ).toBe("42501");
    expect(
      await scalar(
        db,
        "select bool_and(octet_length(flag_hash)=32) as v from public.ctf_challenges",
      ),
    ).toBe(true);
    expect(
      JSON.stringify(
        (await db.query("select metadata from public.audit_logs")).rows,
      ),
    ).not.toContain("flag{secret}");
  });
  it("records attempts and awards points exactly once, with tied ranks", async () => {
    const id = await challenge();
    const flag = (actor: string, value: string) =>
      call(actor, "select private.submit_flag($1,$2,$3) as v", [
        w.orgA.id,
        id,
        value,
      ]);
    expect(await flag(w.memberA, "wrong")).toBe("incorrect");
    expect(await flag(w.memberA, "flag{secret}")).toBe("solved");
    expect(await flag(w.memberA, "flag{secret}")).toBe("already_solved");
    expect(await flag(w.crossUser, "flag{secret}")).toBe("solved");
    const board = await exec(
      w.memberA,
      "select rank,points from public.ctf_scoreboard",
    );
    expect(board.rows).toEqual([
      { rank: 1, points: 100 },
      { rank: 1, points: 100 },
    ]);
    expect(await count("ctf_attempts")).toBe(4);
    expect(await count("ctf_solves")).toBe(2);
  });
  it("rejects cross-club submissions and flags outside event time", async () => {
    const id = await challenge();
    expect(
      (
        await pgError(
          call(
            w.officerB,
            "select private.submit_flag($1,$2,'flag{secret}') as v",
            [w.orgA.id, id],
          ),
        )
      ).code,
    ).toBe("CS404");
    await db.query("update public.events set status='completed' where id=$1", [
      event,
    ]);
    expect(
      (
        await pgError(
          call(
            w.memberA,
            "select private.submit_flag($1,$2,'flag{secret}') as v",
            [w.orgA.id, id],
          ),
        )
      ).code,
    ).toBe("CS404");
  });
  it("only solvers publish write-ups after the event ends", async () => {
    const id = await challenge();
    await call(
      w.memberA,
      "select private.submit_flag($1,$2,'flag{secret}') as v",
      [w.orgA.id, id],
    );
    const write = (actor: string) =>
      call(
        actor,
        "select private.save_writeup($1,$2,'My solution','test-model',$3::jsonb) as v",
        [w.orgA.id, id, chunks],
      );
    expect((await pgError(write(w.memberA))).code).toBe("CS409");
    await db.query("update public.events set status='completed' where id=$1", [
      event,
    ]);
    expect((await pgError(write(w.crossUser))).code).toBe("CS404");
    await write(w.memberA);
    expect(await count("document_chunks")).toBe(1);
    expect((await pgError(write(w.memberA))).code).toBe("CS404");
  });
});
describe("certificates, feedback and analytics", () => {
  it("issues once for checked-in attendees only and exposes only printed fields publicly", async () => {
    await checkIn();
    const issue = () =>
      call(w.officerA, "select private.issue_certificates($1,$2) as v", [
        w.orgA.id,
        event,
      ]);
    expect((await pgError(issue())).code).toBe("CS409");
    await db.query("update public.events set status='completed' where id=$1", [
      event,
    ]);
    expect(await issue()).toBe(1);
    expect(await issue()).toBe(0);
    const code = await scalar<string>(
      db,
      "select verification_code as v from public.certificates",
    );
    expect(code).toMatch(/^[a-f0-9]{64}$/);
    const data = await asAnon(db, (tx) =>
      tx.query("select * from public.verify_certificate($1)", [code]),
    );
    expect(Object.keys(data.rows[0]!)).toEqual([
      "recipient_name",
      "event_title",
      "organization_name",
      "issued_at",
    ]);
    expect(
      (
        await asAnon(db, (tx) =>
          tx.query("select * from public.verify_certificate('bad')"),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await pgError(
          asAnon(db, (tx) => tx.query("select * from public.certificates")),
        )
      ).code,
    ).toBe("42501");
  });
  it("rejects non-attendees, duplicate feedback and invalid ratings without orphan documents", async () => {
    await checkIn();
    await db.query("update public.events set status='completed' where id=$1", [
      event,
    ]);
    expect((await pgError(feedback(w.crossUser))).code).toBe("CS404");
    expect((await pgError(feedback(w.memberA, 0))).code).toBe("23514");
    expect(await count("documents")).toBe(0);
    await feedback();
    expect(await count("document_chunks")).toBe(1);
    expect((await pgError(feedback())).code).toBe("23505");
    expect(await count("documents")).toBe(1);
  });
  it("combines all four contribution sources without multiplying counts", async () => {
    await checkIn();
    const tid = await task(),
      mid = await membershipId(db, w.orgA.id, w.memberA),
      cid = await challenge();
    await call(w.officerA, "select private.assign_task($1,$2,$3) as v", [
      w.orgA.id,
      tid,
      mid,
    ]);
    await call(w.memberA, "select private.complete_task($1,$2) as v", [
      w.orgA.id,
      tid,
    ]);
    await call(
      w.memberA,
      "select private.submit_flag($1,$2,'flag{secret}') as v",
      [w.orgA.id, cid],
    );
    await db.query("update public.events set status='completed' where id=$1", [
      event,
    ]);
    await call(w.officerA, "select private.issue_certificates($1,$2) as v", [
      w.orgA.id,
      event,
    ]);
    const report = await exec(
      w.officerA,
      "select attended,tasks_completed,ctf_points,certificates,score,rank from public.report_member_contributions where user_id=$1",
      [w.memberA],
    );
    expect(report.rows).toEqual([
      {
        attended: 1,
        tasks_completed: 1,
        ctf_points: 100,
        certificates: 1,
        score: 135,
        rank: 1,
      },
    ]);
    expect(
      (
        await exec(
          w.memberA,
          "select * from public.report_member_contributions",
        )
      ).rows,
    ).toEqual([]);
  });
});
describe("module guards and request limits", () => {
  it("blocks every module for suspended members and disabled clubs", async () => {
    const tid = await task(),
      cid = await challenge();
    await call(w.ownerA, "select private.suspend_membership($1,'Test') as v", [
      await membershipId(db, w.orgA.id, w.officerA),
    ]);
    const queries: [string, unknown[]][] = [
      [
        "select private.adjust_inventory($1,$2,null,1,'Restock') as v",
        [w.orgA.id, item],
      ],
      [
        "select private.create_task($1,null,'Forbidden task','',null) as v",
        [w.orgA.id],
      ],
      ["select private.complete_task($1,$2) as v", [w.orgA.id, tid]],
      [
        "select private.submit_flag($1,$2,'flag{secret}') as v",
        [w.orgA.id, cid],
      ],
      ["select private.issue_certificates($1,$2) as v", [w.orgA.id, event]],
    ];
    for (const [q, p] of queries)
      expect((await pgError(call(w.officerA, q, p))).code).toBe("CS404");
    await db.exec("update public.organizations set settings='{}'");
    expect((await pgError(claim(w.ownerA))).code).toBe("CS404");
    expect(
      (await exec(w.ownerA, "select * from public.inventory_items")).rows,
    ).toEqual([]);
  });
  it("reserves per-user request budgets atomically and resets expired windows", async () => {
    for (let n = 0; n < 6; n++)
      expect(
        await call(
          w.memberA,
          "select private.reserve_request('membership') as v",
        ),
      ).toBe(true);
    expect(
      await call(
        w.memberA,
        "select private.reserve_request('membership') as v",
      ),
    ).toBe(false);
    expect(
      await call(
        w.crossUser,
        "select private.reserve_request('membership') as v",
      ),
    ).toBe(true);
    await db.exec(
      "update private.request_limits set started_at=now()-interval '11 minutes'",
    );
    expect(
      await call(
        w.memberA,
        "select private.reserve_request('membership') as v",
      ),
    ).toBe(true);
    expect(
      (await pgError(exec(w.memberA, "select * from private.request_limits")))
        .code,
    ).toBe("42501");
  });
});
