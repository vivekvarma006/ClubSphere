import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthUser, freshWorld, requestMembership, type World } from "./fixtures";
import { asAnon, asUser, pgError } from "./harness";

let db: PGlite;
let w: World;

beforeEach(async () => {
  ({ db, w } = await freshWorld());
});

/** Rows of `sql` visible to `actor` under RLS. */
const visibleTo = async <T>(actor: string, sql: string, params: unknown[] = []) =>
  (await asUser(db, actor, (tx) => tx.query<T>(sql, params))).rows;

describe("organization isolation", () => {
  it("officers see their own organization's request queue and nothing from others", async () => {
    await requestMembership(db, w.applicant, w.orgA.slug);
    await requestMembership(db, w.applicant, w.orgB.slug);

    const rows = await visibleTo<{ organization_id: string }>(
      w.officerA,
      "select distinct organization_id from public.membership_requests where status = 'pending'",
    );
    expect(rows).toEqual([{ organization_id: w.orgA.id }]);
  });

  it("an explicit filter on another organization's id returns nothing", async () => {
    // Supplying B's id does not grant access to B.
    const members = await visibleTo(w.officerA, "select id from public.organization_memberships where organization_id = $1", [
      w.orgB.id,
    ]);
    const roles = await visibleTo(w.officerA, "select role_id from public.membership_roles where organization_id = $1", [
      w.orgB.id,
    ]);
    expect(members).toEqual([]);
    expect(roles).toEqual([]);
  });

  it("a user with different roles in two organizations gets each organization's rights only there", async () => {
    const inA = await visibleTo(w.crossUser, "select id from public.organization_memberships where organization_id = $1", [
      w.orgA.id,
    ]);
    const inB = await visibleTo<{ user_id: string }>(
      w.crossUser,
      "select user_id from public.organization_memberships where organization_id = $1",
      [w.orgB.id],
    );
    expect(inA.length).toBe(4); // officer in A: sees the whole member list
    expect(inB).toEqual([{ user_id: w.crossUser }]); // member in B: sees only themselves
  });

  it("plain members see only their own membership", async () => {
    const rows = await visibleTo<{ user_id: string }>(w.memberA, "select user_id from public.organization_memberships");
    expect(rows).toEqual([{ user_id: w.memberA }]);
  });
});

describe("private data of other users", () => {
  it("applicants see their own requests, not other applicants' requests", async () => {
    const other = await createAuthUser(db, { email: "other-applicant@example.test" });
    await requestMembership(db, w.applicant, w.orgA.slug);
    await requestMembership(db, other, w.orgA.slug);

    const rows = await visibleTo<{ user_id: string }>(w.applicant, "select user_id from public.membership_requests");
    expect(rows).toEqual([{ user_id: w.applicant }]);
  });

  it("profiles are private unless you review or manage that person", async () => {
    await requestMembership(db, w.applicant, w.orgA.slug);
    const profile = (actor: string, id: string) => visibleTo(actor, "select id from public.profiles where id = $1", [id]);

    expect(await profile(w.applicant, w.applicant)).toHaveLength(1); // self
    expect(await profile(w.memberA, w.applicant)).toHaveLength(0); // fellow user, no permission
    expect(await profile(w.officerA, w.applicant)).toHaveLength(1); // reviewer of their request
    expect(await profile(w.officerB, w.applicant)).toHaveLength(0); // officer elsewhere
    expect(await profile(w.officerA, w.memberB)).toHaveLength(0); // member of another org
    expect(await profile(w.crossUser, w.memberB)).toHaveLength(0); // plain member in B
  });

  it("users can edit their own display name but nobody else's, and never their email copy", async () => {
    await asUser(db, w.memberA, (tx) =>
      tx.query("update public.profiles set display_name = 'Renamed' where id = $1", [w.memberA]),
    );
    const other = await asUser(db, w.memberA, (tx) =>
      tx.query("update public.profiles set display_name = 'Hacked' where id = $1", [w.memberB]),
    );
    expect(other.affectedRows).toBe(0);

    const err = await pgError(
      asUser(db, w.memberA, (tx) => tx.query("update public.profiles set email = 'x@campus.test' where id = $1", [w.memberA])),
    );
    expect(err.code).toBe("42501");

    const names = await db.query<{ id: string; display_name: string }>(
      "select id, display_name from public.profiles where id = any($1)",
      [[w.memberA, w.memberB]],
    );
    expect(Object.fromEntries(names.rows.map((r) => [r.id, r.display_name]))).toEqual({
      [w.memberA]: "Renamed",
      [w.memberB]: "member-b",
    });
  });

  it("users can only see whether they themselves are a platform admin", async () => {
    expect(await visibleTo(w.ownerA, "select user_id from public.platform_admins")).toEqual([]);
    expect(await visibleTo(w.platformAdmin, "select user_id from public.platform_admins")).toEqual([
      { user_id: w.platformAdmin },
    ]);
  });
});

describe("audit log visibility", () => {
  it("owners read their organization's log; officers without audit.read read nothing", async () => {
    const ownerRows = await visibleTo<{ organization_id: string }>(
      w.ownerA,
      "select distinct organization_id from public.audit_logs",
    );
    expect(ownerRows).toEqual([{ organization_id: w.orgA.id }]);
    expect(await visibleTo(w.officerA, "select id from public.audit_logs")).toEqual([]);
  });

  it("platform admins can read every organization's log", async () => {
    const rows = await visibleTo<{ n: number }>(
      w.platformAdmin,
      "select count(distinct organization_id)::int as n from public.audit_logs",
    );
    expect(rows[0]?.n).toBe(2);
  });
});

describe("signed-out visitors (anon key)", () => {
  it.each(["profiles", "organizations", "membership_requests", "organization_memberships", "audit_logs", "report_org_membership_summary"])(
    "cannot read %s",
    async (table) => {
      const err = await pgError(asAnon(db, (tx) => tx.query(`select * from public.${table}`)));
      expect(err.code).toBe("42501");
    },
  );
});
