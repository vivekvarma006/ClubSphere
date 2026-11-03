import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifiedActor } from "@/server/auth/actor";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import {
  getSettings,
  deleteCustomRole,
  saveSettings,
  saveCustomRole,
  getAuditLog,
  listAdminClubs,
  createClub,
  setClubStatus,
} from "@/server/services/administration";
import { listMembers, changeMemberRole } from "@/server/services/memberships";
import { freshWorld, membershipId, roleId, type World } from "./fixtures";
import { asUser, pgError, scalar } from "./harness";
let pg: PGlite, db: Database, w: World;
const actor = (id: string) => verifiedActor(id, null);
beforeEach(async () => {
  ({ db: pg, w } = await freshWorld());
  db = drizzle(pg, { schema });
});
afterEach(async () => {
  await pg?.close();
});
const settings = () => ({
  name: "Renamed Society",
  policy: "approval_required",
  branding: { primaryColor: "#1d4ed8" },
  settings: { features: { inventory: true } },
  domains: ["example.test"],
  fields: [
    {
      key: "year",
      label: "Year",
      type: "select",
      required: true,
      options: ["1", "2"],
    },
  ],
});
describe("club administration", () => {
  it("saves branding, features, domains and questions in one transaction", async () => {
    await saveSettings(db, actor(w.ownerA), w.orgA.slug, settings());
    const data = await getSettings(db, actor(w.ownerA), w.orgA.slug);
    expect(data.organization.name).toBe("Renamed Society");
    expect(data.organization.settings).toMatchObject({
      features: { inventory: true, ctf: false },
    });
    expect(data.domains.map((d) => d.domain)).toEqual(["example.test"]);
    expect(data.fields[0]).toMatchObject({
      fieldKey: "year",
      options: ["1", "2"],
    });
    expect(
      (await getAuditLog(db, actor(w.ownerA), w.orgA.slug)).length,
    ).toBeGreaterThan(0);
  });
  it("rejects ordinary members, foreign-club managers and invalid questions", async () => {
    await expect(
      saveSettings(db, actor(w.memberA), w.orgA.slug, settings()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      saveSettings(db, actor(w.ownerB), w.orgA.slug, settings()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      saveSettings(db, actor(w.ownerA), w.orgA.slug, {
        ...settings(),
        fields: [{ key: "bad", label: "Bad", type: "select", required: true }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(
      (await getSettings(db, actor(w.ownerA), w.orgA.slug)).organization.name,
    ).toBe("Alpha Society");
  });
  it("creates custom roles, updates grants and rejects privilege escalation through direct calls", async () => {
    await saveCustomRole(db, actor(w.ownerA), w.orgA.slug, {
      roleId: null,
      key: "scanner",
      name: "Scanner",
      permissions: ["event.checkin"],
    });
    const data = await getSettings(db, actor(w.ownerA), w.orgA.slug),
      role = data.roles.find((r) => r.roleKey === "scanner")!;
    await saveCustomRole(db, actor(w.ownerA), w.orgA.slug, {
      roleId: role.id,
      key: "scanner",
      name: "Meal helper",
      permissions: ["food.distribute"],
    });
    expect(
      (await getSettings(db, actor(w.ownerA), w.orgA.slug)).grants
        .filter((g) => g.roleId === role.id)
        .map((g) => g.permissionKey),
    ).toEqual(["food.distribute"]);
    expect(
      (
        await pgError(
          asUser(pg, w.officerA, (tx) =>
            tx.query(
              "select private.save_custom_role($1,null,'escalated','Escalated',array['role.manage'])",
              [w.orgA.id],
            ),
          ),
        )
      ).code,
    ).toBe("CS404");
  });
  it("does not allow a partial permission replacement on a role above the caller", async () => {
    const officer = await roleId(pg, w.orgA.id, "officer");
    await pg.query(
      "insert into public.role_permissions(organization_id,role_id,permission_key) values($1,$2,'role.manage')",
      [w.orgA.id, officer],
    );
    await saveCustomRole(db, actor(w.ownerA), w.orgA.slug, {
      roleId: null,
      key: "powerful",
      name: "Powerful",
      permissions: ["role.assign", "event.checkin"],
    });
    const id = await roleId(pg, w.orgA.id, "powerful");
    await expect(
      saveCustomRole(db, actor(w.officerA), w.orgA.slug, {
        roleId: id,
        key: "powerful",
        name: "Edited",
        permissions: ["event.checkin"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await scalar(
        pg,
        "select count(*)::int as v from public.role_permissions where role_id=$1",
        [id],
      ),
    ).toBe(2);
  });
  it("lists members only with member.read and scopes role changes to the URL club", async () => {
    expect(
      (await listMembers(db, actor(w.officerA), w.orgA.slug)).members,
    ).toHaveLength(4);
    await expect(
      listMembers(db, actor(w.memberA), w.orgA.slug),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      changeMemberRole(db, actor(w.ownerA), {
        organizationSlug: w.orgA.slug,
        membershipId: await membershipId(pg, w.orgB.id, w.memberB),
        roleId: await roleId(pg, w.orgA.id, "member"),
        revoke: false,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("deletes custom roles only with cascading-effect authorization", async () => {
    await saveCustomRole(db, actor(w.ownerA), w.orgA.slug, {
      roleId: null,
      key: "helper",
      name: "Helper",
      permissions: ["event.checkin"],
    });
    const id = await roleId(pg, w.orgA.id, "helper");
    const member = await membershipId(pg, w.orgA.id, w.memberA);
    await asUser(pg, w.ownerA, (tx) =>
      tx.query("select private.assign_role($1,$2)", [member, id]),
    );
    await expect(
      deleteCustomRole(db, actor(w.officerA), w.orgA.slug, id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deleteCustomRole(db, actor(w.ownerA), w.orgA.slug, id);
    expect(
      await scalar(
        pg,
        "select count(*)::int as v from public.membership_roles where role_id=$1",
        [id],
      ),
    ).toBe(0);
    await expect(
      deleteCustomRole(
        db,
        actor(w.ownerA),
        w.orgA.slug,
        await roleId(pg, w.orgA.id, "owner"),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("restricts platform controls to platform administrators", async () => {
    await expect(listAdminClubs(db, actor(w.ownerA))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await createClub(db, actor(w.platformAdmin), {
      slug: "new-society",
      name: "New Society",
      ownerId: w.applicant,
    });
    const clubs = await listAdminClubs(db, actor(w.platformAdmin)),
      club = clubs.find((c) => c.slug === "new-society")!;
    await setClubStatus(db, actor(w.platformAdmin), club.id, "suspended");
    expect(
      (await listAdminClubs(db, actor(w.platformAdmin))).find(
        (c) => c.id === club.id,
      )?.status,
    ).toBe("suspended");
  });
});
