import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * True concurrency needs several connections, which PGlite cannot provide.
 * This suite runs against a REAL Postgres that already has the migrations
 * applied, e.g. a local Supabase stack:
 *
 *   npx supabase start
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test
 *
 * It is skipped when TEST_DATABASE_URL is not set. Never point it at a
 * shared or production database: it creates and deletes data.
 */
const url = process.env.TEST_DATABASE_URL;

function one<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected a row");
  return row;
}

describe.skipIf(!url)("concurrent operations on real Postgres", () => {
  const sql = postgres(url ?? "postgres://unused", { max: 4, onnotice: () => {} });
  const runId = randomUUID().slice(0, 8);
  const slug = `conc-${runId}`;
  let admin = "";
  let ownerA = "";
  let ownerB = "";
  let applicant = "";
  let orgId = "";

  /** One transaction as `userId`, on its own pooled connection. */
  const asUser = <T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
      await tx`set local role authenticated`;
      return fn(tx);
    });

  const scalarAs = async (userId: string, query: (tx: postgres.TransactionSql) => postgres.PendingQuery<postgres.Row[]>) =>
    String(one(await asUser(userId, (tx) => query(tx))).v);

  const count = async (query: postgres.PendingQuery<postgres.Row[]>) => Number(one(await query).n);

  const createUser = async (name: string) =>
    String(
      one(await sql`insert into auth.users (id, email, email_confirmed_at)
                    values (gen_random_uuid(), ${`${name}-${runId}@example.test`}, now()) returning id`).id,
    );

  const codeOf = (result: PromiseSettledResult<unknown>) =>
    result.status === "rejected" ? (result.reason as { code?: string }).code : "ok";

  beforeAll(async () => {
    admin = await createUser("admin");
    ownerA = await createUser("owner-a");
    ownerB = await createUser("owner-b");
    applicant = await createUser("applicant");
    await sql`insert into public.platform_admins (user_id) values (${admin})`;
    orgId = await scalarAs(admin, (tx) => tx`select private.create_organization(${slug}, 'Concurrency Test', ${ownerA}) as v`);

    // A second owner, for the write-skew test.
    const requestId = await scalarAs(ownerB, (tx) => tx`select private.request_membership(${slug}, '{}') as v`);
    const membershipId = await scalarAs(ownerA, (tx) => tx`select private.approve_membership_request(${requestId}) as v`);
    await asUser(ownerA, (tx) => tx`
      select private.assign_role(${membershipId},
        (select id from public.organization_roles where organization_id = ${orgId} and role_key = 'owner'))`);
  });

  afterAll(async () => {
    if (orgId) await sql`delete from public.organizations where id = ${orgId}`;
    await sql`delete from auth.users where email like ${`%-${runId}@example.test`}`;
    await sql.end();
  });

  it("two simultaneous submissions create one request", async () => {
    const ids = await Promise.all(
      [1, 2].map(() => scalarAs(applicant, (tx) => tx`select private.request_membership(${slug}, '{}') as v`)),
    );
    expect(ids[0]).toBe(ids[1]);
    expect(
      await count(sql`select count(*)::int as n from public.membership_requests
                       where organization_id = ${orgId} and user_id = ${applicant}`),
    ).toBe(1);
  });

  it("two reviewers approving at the same moment: one succeeds, one gets CS409", async () => {
    const requestId = String(
      one(await sql`select id from public.membership_requests
                     where organization_id = ${orgId} and user_id = ${applicant} and status = 'pending'`).id,
    );
    const results = await Promise.allSettled(
      [ownerA, ownerB].map((reviewer) => asUser(reviewer, (tx) => tx`select private.approve_membership_request(${requestId})`)),
    );
    expect(results.map(codeOf).sort()).toEqual(["CS409", "ok"]);
    expect(
      await count(sql`select count(*)::int as n from public.organization_memberships
                       where organization_id = ${orgId} and user_id = ${applicant}`),
    ).toBe(1);
  });

  it("meal replay is idempotent and two attendees cannot consume the last stock unit", async () => {
    await asUser(ownerA, tx => tx`update public.organizations set settings='{"features":{"inventory":true}}' where id=${orgId}`);
    const event = await scalarAs(ownerA, tx => tx`insert into public.events(organization_id,title,starts_at,ends_at,status)
      values(${orgId},'Meal race',now()-interval '1 hour',now()+interval '1 hour','published') returning id as v`);
    const regA = await scalarAs(ownerA, tx => tx`select private.register_for_event(${event}) as v`);
    const regB = await scalarAs(applicant, tx => tx`select private.register_for_event(${event}) as v`);
    await asUser(ownerA, tx => tx`select private.check_in_registration(${regA}), private.check_in_registration(${regB})`);
    const tokenA = await scalarAs(ownerA, tx => tx`select token as v from public.registration_credentials where registration_id=${regA}`);
    const tokenB = await scalarAs(applicant, tx => tx`select token as v from public.registration_credentials where registration_id=${regB}`);
    const item = await scalarAs(ownerA, tx => tx`select private.adjust_inventory(${orgId},null,'Race stock',1,'Delivery') as v`);
    const slot = await scalarAs(ownerA, tx => tx`select private.create_meal_slot(${orgId},${event},${item},'First meal') as v`);
    try {
      const replay = await Promise.all([ownerA,ownerB].map(scanner => asUser(scanner, tx => tx`select private.claim_meal(${event},${slot},${tokenA}) as v`)));
      expect(replay.map(rows => String((one(rows).v as { status: string }).status)).sort()).toEqual(['already_claimed','claimed']);
      expect(await count(sql`select count(*)::int as n from public.food_claims where meal_slot_id=${slot}`)).toBe(1);
      await asUser(ownerA, tx => tx`select private.adjust_inventory(${orgId},${item},null,1,'Second delivery')`);
      const slot2 = await scalarAs(ownerA, tx => tx`select private.create_meal_slot(${orgId},${event},${item},'Second meal') as v`);
      const race = await Promise.allSettled([tokenA,tokenB].map(token => asUser(ownerA, tx => tx`select private.claim_meal(${event},${slot2},${token})`)));
      expect(race.map(codeOf).sort()).toEqual(['23514','ok']);
      expect(await count(sql`select quantity as n from public.inventory_items where id=${item}`)).toBe(0);
      expect(await count(sql`select count(*)::int as n from public.food_claims where meal_slot_id=${slot2}`)).toBe(1);
    } finally {
      await sql`delete from public.food_claims where event_id=${event}`;
      await sql`delete from public.meal_slots where event_id=${event}`;
      await sql`delete from public.stock_movements where item_id=${item}`;
      await sql`delete from public.inventory_items where id=${item}`;
      await sql`delete from public.events where id=${event}`;
    }
  });

  it("event registrations serialize the last seat and concurrent waitlist joins are idempotent", async () => {
    const event = await scalarAs(ownerA, tx => tx`insert into public.events(organization_id,title,starts_at,ends_at,capacity,status)
      values(${orgId},'Waitlist race',now()+interval '1 day',now()+interval '2 days',1,'published') returning id as v`);
    try {
      const race = await Promise.allSettled([ownerA, ownerB].map(user => scalarAs(user,tx => tx`select private.register_for_event(${event}) as v`)));
      expect(race.map(codeOf).sort()).toEqual(['CS409','ok']);
      const winner = String(one(await sql`select user_id from public.event_registrations where event_id=${event} and status='registered'`).user_id);
      const waiter = winner === ownerA ? ownerB : ownerA;
      await Promise.all([1,2].map(() => asUser(waiter,tx => tx`select private.join_event_waitlist(${event})`)));
      expect(await count(sql`select count(*)::int as n from public.event_waitlist where event_id=${event} and status='waiting'`)).toBe(1);
      const registration = String(one(await sql`select id from public.event_registrations where event_id=${event} and user_id=${winner}`).id);
      const attempts = await Promise.allSettled([
        asUser(winner,tx => tx`select private.cancel_registration(${registration})`),
        asUser(applicant,tx => tx`select private.register_for_event(${event})`),
      ]);
      expect(attempts.map(codeOf)).toEqual(['ok','CS409']);
      expect(await count(sql`select count(*)::int as n from public.event_registrations where event_id=${event} and status='registered'`)).toBe(1);
      expect(String(one(await sql`select user_id from public.event_registrations where event_id=${event} and status='registered'`).user_id)).toBe(waiter);
    } finally {
      await sql`delete from public.events where id=${event}`;
    }
  });

  it("two owners suspending each other at once cannot leave the club ownerless (write skew)", async () => {
    const membershipOf = async (user: string) =>
      String(one(await sql`select id from public.organization_memberships where organization_id = ${orgId} and user_id = ${user}`).id);
    const [a, b] = [await membershipOf(ownerA), await membershipOf(ownerB)];

    const results = await Promise.allSettled([
      asUser(ownerA, (tx) => tx`select private.suspend_membership(${b}, 'race')`),
      asUser(ownerB, (tx) => tx`select private.suspend_membership(${a}, 'race')`),
    ]);
    // The second waits on the organization row lock, then finds its caller suspended.
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await count(sql`select count(*)::int as n from public.organization_memberships m
                        join public.membership_roles mr on mr.membership_id = m.id
                        join public.organization_roles r on r.id = mr.role_id
                       where m.organization_id = ${orgId} and m.status = 'active' and r.role_key = 'owner'`),
    ).toBe(1);
  });
});
