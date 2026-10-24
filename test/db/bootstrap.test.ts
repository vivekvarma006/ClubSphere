import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAuthUser } from "./fixtures";
import { freshDb, pgError, scalar } from "./harness";

const SCRIPT = path.resolve(import.meta.dirname, "../../supabase/bootstrap/first_platform_admin_and_organization.sql");

async function bootstrapSql(values: { admin: string; owner: string; slug: string; name: string }) {
  return (await readFile(SCRIPT, "utf8"))
    .replaceAll("REPLACE_platform_admin@example.com", values.admin)
    .replaceAll("REPLACE_owner@example.com", values.owner)
    .replaceAll("REPLACE-club-slug", values.slug)
    .replaceAll("REPLACE Club Name", values.name);
}

describe("bootstrap script", () => {
  it("creates the first platform admin and an organization owned by its owner", async () => {
    const db = await freshDb();
    const admin = await createAuthUser(db, { email: "admin@example.test" });
    const owner = await createAuthUser(db, { email: "owner@example.test" });

    await db.exec(await bootstrapSql({ admin: "admin@example.test", owner: "owner@example.test", slug: "first-club", name: "First Club" }));

    expect(await scalar<boolean>(db, "select exists(select 1 from public.platform_admins where user_id = $1) as v", [admin])).toBe(true);
    const ownerRole = await scalar<string>(
      db,
      `select r.role_key as v from public.organization_memberships m
         join public.organizations o on o.id = m.organization_id
         join public.membership_roles mr on mr.membership_id = m.id
         join public.organization_roles r on r.id = mr.role_id
        where o.slug = 'first-club' and m.user_id = $1`,
      [owner],
    );
    expect(ownerRole).toBe("owner");
    expect(await scalar<string>(db, "select current_user as v")).toBe("postgres"); // role reset after commit
  });

  it("stops with a clear message if someone has not signed up", async () => {
    const db = await freshDb();
    await createAuthUser(db, { email: "admin@example.test" });
    const err = await pgError(
      db.exec(await bootstrapSql({ admin: "admin@example.test", owner: "missing@example.test", slug: "first-club", name: "First Club" })),
    );
    expect(err.message).toMatch(/owner has not signed up/);
    await db.exec("rollback"); // the script's explicit transaction is aborted; nothing was committed
    expect(await scalar<number>(db, "select count(*)::int as v from public.organizations")).toBe(0);
    expect(await scalar<number>(db, "select count(*)::int as v from public.platform_admins")).toBe(0);
  });
});
