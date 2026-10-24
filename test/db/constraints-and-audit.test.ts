import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { approve, freshWorld, membershipId, requestMembership, roleId, type World } from "./fixtures";
import { asUser, pgError, scalar } from "./harness";

// These run as the table owner (no RLS) to show that integrity rules hold
// no matter which code path writes the data.

let db: PGlite;
let w: World;

beforeEach(async () => {
  ({ db, w } = await freshWorld());
});

describe("database-level validation", () => {
  it.each(["Bad Slug", "-leading", "trailing-", "ab", "double--dash", "UPPER"])("rejects organization slug %j", async (slug) => {
    const err = await pgError(db.query("insert into public.organizations (slug, name) values ($1, 'Valid Name')", [slug]));
    expect(err.code).toBe("23514"); // check_violation
  });

  it("rejects duplicate slugs", async () => {
    const err = await pgError(db.query("insert into public.organizations (slug, name) values ('alpha-society', 'Copy')"));
    expect(err.code).toBe("23505"); // unique_violation
  });

  it("allows only one pending request per user per organization", async () => {
    const insert = () =>
      db.query("insert into public.membership_requests (organization_id, user_id) values ($1, $2)", [w.orgA.id, w.applicant]);
    await insert();
    expect((await pgError(insert())).code).toBe("23505");
  });

  it("keeps review metadata consistent with request status", async () => {
    const id = await requestMembership(db, w.applicant, w.orgA.slug);
    const bad = [
      "update public.membership_requests set status = 'approved' where id = $1", // no reviewed_at
      "update public.membership_requests set rejection_reason = 'no' where id = $1", // reason while pending
      "update public.membership_requests set status = 'withdrawn' where id = $1", // no withdrawn_at
      "update public.membership_requests set status = 'maybe' where id = $1",
    ];
    for (const sql of bad) {
      expect((await pgError(db.query(sql, [id]))).code, sql).toBe("23514");
    }
  });

  it("keeps suspension metadata consistent with membership status", async () => {
    const mId = await membershipId(db, w.orgA.id, w.memberA);
    const err = await pgError(db.query("update public.organization_memberships set status = 'suspended' where id = $1", [mId]));
    expect(err.code).toBe("23514");
  });

  it("composite foreign keys stop a role from org B being attached to a membership in org A", async () => {
    const err = await pgError(
      db.query("insert into public.membership_roles (organization_id, membership_id, role_id) values ($1, $2, $3)", [
        w.orgA.id,
        await membershipId(db, w.orgA.id, w.memberA),
        await roleId(db, w.orgB.id, "officer"),
      ]),
    );
    expect(err.code).toBe("23503"); // foreign_key_violation
  });

  it("allows only one default role per organization", async () => {
    const err = await pgError(
      db.query("update public.organization_roles set is_default = true where organization_id = $1 and role_key = 'officer'", [
        w.orgA.id,
      ]),
    );
    expect(err.code).toBe("23505");
  });

  it("requires options exactly when a profile field is a select", async () => {
    for (const [type, options] of [
      ["select", null],
      ["text", '["a"]'],
      ["select", '"not-an-array"'],
    ] as const) {
      const err = await pgError(
        db.query(
          "insert into public.organization_profile_fields (organization_id, field_key, label, field_type, options) values ($1, 'f', 'F', $2, $3::jsonb)",
          [w.orgA.id, type, options],
        ),
      );
      expect(err.code).toBe("23514");
    }
  });
});

describe("audit log", () => {
  it("records membership changes with the reviewer as actor and no personal values", async () => {
    const reqId = await requestMembership(db, w.applicant, w.orgA.slug);
    const marker = await scalar<number>(db, "select max(id)::int as v from public.audit_logs");
    await approve(db, w.officerA, reqId);

    const { rows } = await db.query<{ action: string; actor_id: string; metadata: Record<string, unknown> }>(
      `select action, actor_id, metadata from public.audit_logs where id > $1 order by id`,
      [marker],
    );
    expect(new Set(rows.map((r) => r.actor_id))).toEqual(new Set([w.officerA]));
    expect(rows.map((r) => r.action)).toEqual([
      "membership.created",
      "membership_role.created",
      "membership_request.status_changed",
    ]);
    expect(rows[2]?.metadata).toMatchObject({ from: "pending", to: "approved", user_id: w.applicant });
    expect(JSON.stringify(rows)).not.toMatch(/example\.test/); // no emails copied into the log
  });

  it("records the applicant as actor of their own request", async () => {
    await requestMembership(db, w.applicant, w.orgA.slug);
    const actor = await scalar<string>(
      db,
      "select actor_id as v from public.audit_logs where action = 'membership_request.created' and organization_id = $1 order by id desc limit 1",
      [w.orgA.id],
    );
    expect(actor).toBe(w.applicant);
  });

  it("is append-only, even for the table owner", async () => {
    for (const sql of ["update public.audit_logs set action = 'x.y'", "delete from public.audit_logs", "truncate public.audit_logs"]) {
      const err = await pgError(db.query(sql));
      expect(err.code, sql).toBe("CS403");
    }
  });
});

describe("transactions", () => {
  it("roll back everything, including audit rows, when a later step fails", async () => {
    const auditBefore = await scalar<number>(db, "select count(*)::int as v from public.audit_logs");

    const err = await pgError(
      asUser(db, w.applicant, async (tx) => {
        await tx.query("select private.request_membership($1, '{}')", [w.orgA.slug]);
        await tx.query("select 1 / 0"); // a later statement in the same transaction fails
      }),
    );
    expect(err.code).toBe("22012");

    const requests = await scalar<number>(
      db,
      "select count(*)::int as v from public.membership_requests where user_id = $1",
      [w.applicant],
    );
    expect(requests).toBe(0);
    expect(await scalar<number>(db, "select count(*)::int as v from public.audit_logs")).toBe(auditBefore);
  });

  it("leave no half-created organization when the slug is taken", async () => {
    const orgsBefore = await scalar<number>(db, "select count(*)::int as v from public.organization_roles");
    const err = await pgError(
      asUser(db, w.platformAdmin, (tx) =>
        tx.query("select private.create_organization('alpha-society', 'Duplicate', $1)", [w.applicant]),
      ),
    );
    expect(err.code).toBe("23505");
    expect(await scalar<number>(db, "select count(*)::int as v from public.organization_roles")).toBe(orgsBefore);
  });
});
