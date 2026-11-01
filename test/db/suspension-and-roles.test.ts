import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { approve, freshWorld, membershipId, requestMembership, roleId, type World } from "./fixtures";
import { asUser, pgError, scalar } from "./harness";

let db: PGlite;
let w: World;

beforeEach(async () => {
  ({ db, w } = await freshWorld());
});

const call = (actor: string, sql: string, params: unknown[] = []) =>
  asUser(db, actor, (tx) => tx.query(sql, params));

const permissionsOf = (actor: string, orgId: string) =>
  asUser(db, actor, (tx) => scalar<string[]>(tx, "select private.my_org_permissions($1) as v", [orgId]));

const suspend = async (actor: string, orgId: string, userId: string, reason = "test") =>
  call(actor, "select private.suspend_membership($1, $2)", [await membershipId(db, orgId, userId), reason]);

describe("suspension", () => {
  it("removes a suspended officer's permissions immediately", async () => {
    const pending = await requestMembership(db, w.applicant, w.orgA.slug);
    await suspend(w.ownerA, w.orgA.id, w.officerA);

    expect(await permissionsOf(w.officerA, w.orgA.id)).toEqual([]);
    expect((await pgError(approve(db, w.officerA, pending))).code).toBe("CS404");

    // RLS hides the review queue too (they still see their own old request).
    const visible = await asUser(db, w.officerA, (tx) =>
      tx.query("select id from public.membership_requests where organization_id = $1 and status = 'pending'", [
        w.orgA.id,
      ]),
    );
    expect(visible.rows).toEqual([]);
  });

  it("does not affect the same person's standing in another organization", async () => {
    await suspend(w.ownerA, w.orgA.id, w.crossUser);
    expect(await permissionsOf(w.crossUser, w.orgA.id)).toEqual([]);
    const inB = await asUser(db, w.crossUser, (tx) =>
      scalar<boolean>(tx, "select private.is_active_member($1) as v", [w.orgB.id]),
    );
    expect(inB).toBe(true);
  });

  it("records who suspended, when, and why; reinstating clears it and restores access", async () => {
    await suspend(w.ownerA, w.orgA.id, w.officerA, "Missed three meetings");
    const mId = await membershipId(db, w.orgA.id, w.officerA);
    const row = await db.query<{ status: string; suspended_by: string; suspension_reason: string }>(
      "select status, suspended_by, suspension_reason from public.organization_memberships where id = $1",
      [mId],
    );
    expect(row.rows[0]).toEqual({ status: "suspended", suspended_by: w.ownerA, suspension_reason: "Missed three meetings" });

    await call(w.ownerA, "select private.reinstate_membership($1)", [mId]);
    expect(await permissionsOf(w.officerA, w.orgA.id)).toContain("membership.review");
  });

  it("an officer cannot suspend the owner (rank rule)", async () => {
    const err = await pgError(suspend(w.officerA, w.orgA.id, w.ownerA));
    expect(err).toMatchObject({ code: "CS403", message: expect.stringMatching(/permissions you do not have/) });
  });

  it("an officer can suspend a member, and another officer of equal rank", async () => {
    await suspend(w.officerA, w.orgA.id, w.memberA);
    await suspend(w.officerA, w.orgA.id, w.crossUser);
    expect(await permissionsOf(w.crossUser, w.orgA.id)).toEqual([]);
  });

  it("nobody can suspend themselves", async () => {
    expect((await pgError(suspend(w.officerA, w.orgA.id, w.officerA))).code).toBe("CS403");
  });

  it("members and outsiders cannot suspend anyone", async () => {
    expect((await pgError(suspend(w.memberA, w.orgA.id, w.officerA))).code).toBe("CS404");
    expect((await pgError(suspend(w.officerB, w.orgA.id, w.memberA))).code).toBe("CS404");
    expect((await pgError(suspend(w.crossUser, w.orgB.id, w.memberB))).code).toBe("CS404");
  });

  it("suspending twice, or reinstating an active member, is a state conflict", async () => {
    await suspend(w.ownerA, w.orgA.id, w.memberA);
    expect((await pgError(suspend(w.ownerA, w.orgA.id, w.memberA))).code).toBe("CS409");
    const active = await membershipId(db, w.orgA.id, w.officerA);
    expect((await pgError(call(w.ownerA, "select private.reinstate_membership($1)", [active]))).code).toBe("CS409");
  });
});

describe("role assignment and escalation", () => {
  it("an owner can promote a member to officer", async () => {
    const mId = await membershipId(db, w.orgA.id, w.memberA);
    await call(w.ownerA, "select private.assign_role($1, $2)", [mId, await roleId(db, w.orgA.id, "officer")]);
    expect(await permissionsOf(w.memberA, w.orgA.id)).toContain("membership.review");
  });

  it("officers cannot assign roles at all by default", async () => {
    const mId = await membershipId(db, w.orgA.id, w.memberA);
    const err = await pgError(
      call(w.officerA, "select private.assign_role($1, $2)", [mId, await roleId(db, w.orgA.id, "officer")]),
    );
    expect(err.code).toBe("CS404");
  });

  it("even with role.assign, nobody can hand out a role stronger than their own", async () => {
    // Owner lets officers assign roles.
    await call(w.ownerA, "insert into public.role_permissions (organization_id, role_id, permission_key) values ($1, $2, 'role.assign')", [
      w.orgA.id,
      await roleId(db, w.orgA.id, "officer"),
    ]);
    const mId = await membershipId(db, w.orgA.id, w.memberA);

    await call(w.officerA, "select private.assign_role($1, $2)", [mId, await roleId(db, w.orgA.id, "officer")]);

    const err = await pgError(
      call(w.officerA, "select private.assign_role($1, $2)", [mId, await roleId(db, w.orgA.id, "owner")]),
    );
    expect(err).toMatchObject({ code: "CS403", message: expect.stringMatching(/permissions you do not have/) });
  });

  it("a role from another organization cannot be attached", async () => {
    const mId = await membershipId(db, w.orgA.id, w.memberA);
    const err = await pgError(
      call(w.ownerA, "select private.assign_role($1, $2)", [mId, await roleId(db, w.orgB.id, "officer")]),
    );
    expect(err.code).toBe("CS404");
  });

  it("the last active owner cannot give up the owner role", async () => {
    const mId = await membershipId(db, w.orgA.id, w.ownerA);
    const err = await pgError(
      call(w.ownerA, "select private.revoke_role($1, $2)", [mId, await roleId(db, w.orgA.id, "owner")]),
    );
    expect(err).toMatchObject({ code: "CS409", message: expect.stringMatching(/at least one active owner/) });
  });

  it("with a second owner, ownership can be handed over", async () => {
    const owner = await roleId(db, w.orgA.id, "owner");
    await call(w.ownerA, "select private.assign_role($1, $2)", [await membershipId(db, w.orgA.id, w.officerA), owner]);
    await call(w.ownerA, "select private.revoke_role($1, $2)", [await membershipId(db, w.orgA.id, w.ownerA), owner]);
    expect(await permissionsOf(w.officerA, w.orgA.id)).toContain("role.manage");
    expect(await permissionsOf(w.ownerA, w.orgA.id)).not.toContain("role.manage");
  });

  it("roles cannot be given to suspended members", async () => {
    await suspend(w.ownerA, w.orgA.id, w.memberA);
    const err = await pgError(
      call(w.ownerA, "select private.assign_role($1, $2)", [
        await membershipId(db, w.orgA.id, w.memberA),
        await roleId(db, w.orgA.id, "officer"),
      ]),
    );
    expect(err.code).toBe("CS409");
  });
});

describe("editing role permissions directly (RLS on role_permissions)", () => {
  const grant = async (actor: string, orgId: string, roleKey: string, permission: string) =>
    call(actor, "insert into public.role_permissions (organization_id, role_id, permission_key) values ($1, $2, $3)", [
      orgId,
      await roleId(db, orgId, roleKey),
      permission,
    ]);

  it("an officer cannot add permissions to their own role", async () => {
    expect((await pgError(grant(w.officerA, w.orgA.id, "officer", "audit.read"))).code).toBe("42501");
  });

  it("an owner of A cannot edit B's roles", async () => {
    expect((await pgError(grant(w.ownerA, w.orgB.id, "officer", "audit.read"))).code).toBe("42501");
  });

  it("an owner cannot point a row at A while naming a role from B", async () => {
    const err = await pgError(
      call(w.ownerA, "insert into public.role_permissions (organization_id, role_id, permission_key) values ($1, $2, 'audit.read')", [
        w.orgA.id,
        await roleId(db, w.orgB.id, "officer"),
      ]),
    );
    expect(err.code).toBe("23503"); // composite foreign key violation
  });

  it("holders of role.manage can only grant permissions they hold themselves", async () => {
    // A custom role with role.manage but without audit.read.
    const customRole = await asUser(db, w.ownerA, (tx) =>
      scalar<string>(
        tx,
        "insert into public.organization_roles (organization_id, role_key, name) values ($1, 'role_admin', 'Role admin') returning id as v",
        [w.orgA.id],
      ),
    );
    await call(w.ownerA, "insert into public.role_permissions (organization_id, role_id, permission_key) values ($1, $2, 'role.manage')", [
      w.orgA.id,
      customRole,
    ]);
    await call(w.ownerA, "select private.assign_role($1, $2)", [await membershipId(db, w.orgA.id, w.memberA), customRole]);

    expect((await pgError(grant(w.memberA, w.orgA.id, "member", "audit.read"))).code).toBe("42501");
  });

  it("nobody can edit the owner role's permissions through the API", async () => {
    const owner = await roleId(db, w.orgA.id, "owner");
    const res = await call(
      w.ownerA,
      "delete from public.role_permissions where role_id = $1 and permission_key = 'audit.read'",
      [owner],
    );
    expect(res.affectedRows).toBe(0); // RLS filters the row out of the DELETE
  });

  it("system roles cannot be deleted, and is_system cannot be set through the API", async () => {
    const res = await call(w.ownerA, "delete from public.organization_roles where id = $1", [
      await roleId(db, w.orgA.id, "officer"),
    ]);
    expect(res.affectedRows).toBe(0);

    const err = await pgError(
      call(w.ownerA, "insert into public.organization_roles (organization_id, role_key, name, is_system) values ($1, 'fake', 'Fake', true)", [
        w.orgA.id,
      ]),
    );
    expect(err.code).toBe("42501"); // no column privilege on is_system
  });
});

describe("deleting custom roles", () => {
  it("cannot bypass the permission-subset rule through cascading deletes", async () => {
    const createRole = (key: string) => asUser(db, w.ownerA, (tx) => scalar<string>(tx,
      "insert into public.organization_roles (organization_id, role_key, name) values ($1, $2, $2) returning id as v",
      [w.orgA.id, key],
    ));
    const manager = await createRole("role_admin");
    const privileged = await createRole("auditor");
    await call(w.ownerA,
      "insert into public.role_permissions (organization_id, role_id, permission_key) values ($1, $2, 'role.manage'), ($1, $2, 'role.assign'), ($1, $3, 'audit.read')",
      [w.orgA.id, manager, privileged],
    );
    await call(w.ownerA, "select private.assign_role($1, $2)", [await membershipId(db, w.orgA.id, w.memberA), manager]);
    await call(w.ownerA, "select private.assign_role($1, $2)", [await membershipId(db, w.orgA.id, w.officerA), privileged]);

    const res = await call(w.memberA, "delete from public.organization_roles where id = $1", [privileged]);
    expect(res.affectedRows).toBe(0);
    expect(await permissionsOf(w.officerA, w.orgA.id)).toContain("audit.read");

    // The full permission holder can still delete a custom role.
    expect((await call(w.ownerA, "delete from public.organization_roles where id = $1", [privileged])).affectedRows).toBe(1);
    expect(await permissionsOf(w.officerA, w.orgA.id)).not.toContain("audit.read");
  });

  it("requires role.assign as well as role.manage because deletion removes assignments", async () => {
    const createRole = (key: string) => asUser(db, w.ownerA, (tx) => scalar<string>(tx,
      "insert into public.organization_roles (organization_id, role_key, name) values ($1, $2, $2) returning id as v",
      [w.orgA.id, key],
    ));
    const manager = await createRole("role_admin");
    const target = await createRole("empty_role");
    await call(w.ownerA,
      "insert into public.role_permissions (organization_id, role_id, permission_key) values ($1, $2, 'role.manage')",
      [w.orgA.id, manager],
    );
    await call(w.ownerA, "select private.assign_role($1, $2)", [await membershipId(db, w.orgA.id, w.memberA), manager]);
    await call(w.ownerA, "select private.assign_role($1, $2)", [await membershipId(db, w.orgA.id, w.officerA), target]);

    expect((await call(w.memberA, "delete from public.organization_roles where id = $1", [target])).affectedRows).toBe(0);
    await call(w.ownerA,
      "insert into public.role_permissions (organization_id, role_id, permission_key) values ($1, $2, 'role.assign')",
      [w.orgA.id, manager],
    );
    expect((await call(w.memberA, "delete from public.organization_roles where id = $1", [target])).affectedRows).toBe(1);
  });
});

describe("direct writes to membership tables are impossible through the API", () => {
  it.each([
    ["insert a membership", "insert into public.organization_memberships (organization_id, user_id) values ($1, $2)"],
    ["insert a role assignment", "insert into public.membership_roles (organization_id, membership_id, role_id) values ($1, $2, $2)"],
    ["approve by UPDATE", "update public.membership_requests set status = 'approved' where organization_id = $1 and user_id = $2"],
    ["reactivate by UPDATE", "update public.organization_memberships set status = 'active' where organization_id = $1 and user_id = $2"],
    ["forge an audit entry", "insert into public.audit_logs (organization_id, actor_id, action, target_type) values ($1, $2, 'x.y', 'x')"],
    ["change organization status", "update public.organizations set status = 'active' where id = $1 and $2::uuid is not null"],
  ])("cannot %s, even as the owner", async (_label, sql) => {
    const err = await pgError(call(w.ownerA, sql, [w.orgA.id, w.applicant]));
    expect(err.code).toBe("42501");
  });
});
