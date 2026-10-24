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
