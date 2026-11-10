import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/server/authz/permissions";
import { ROLLBACK_DIR, applyMigrations, freshDb, listRollbacks } from "./harness";

const EXPECTED_TABLES = [
  "audit_logs",
  "certificates",
  "ctf_attempts",
  "ctf_challenges",
  "ctf_solves",
  "document_chunks",
  "documents",
  "event_attendance",
  "event_feedback",
  "event_registrations",
  "event_waitlist",
  "events",
  "food_claims",
  "inventory_items",
  "meal_slots",
  "membership_requests",
  "membership_roles",
  "organization_email_domains",
  "organization_memberships",
  "organization_profile_fields",
  "organization_roles",
  "organizations",
  "permissions",
  "platform_admins",
  "profiles",
  "registration_credentials",
  "role_permissions",
  "role_template_permissions",
  "role_templates",
  "stock_movements",
  "task_assignments",
  "volunteer_tasks",

];

// Functions an API user may call. Anything else in `private` (trigger
// functions, internal helpers) must not be executable by API roles.
const AUTHENTICATED_EXECUTABLE = [
  "adjust_inventory",
  "approve_membership_request",
  "assign_role",
  "assign_task",
  "can_view_profile",
  "cancel_registration",
  "check_in",
  "check_in_registration",
  "claim_meal",
  "complete_task",
  "contribution_report",
  "create_challenge",
  "create_meal_slot",
  "create_organization",
  "create_task",
  "delete_custom_role",
  "delete_document",
  "event_registration_counts",
  "has_org_permission",
  "is_active_member",
  "is_owner_role",
  "is_platform_admin",
  "issue_certificates",
  "join_event_waitlist",
  "leave_event_waitlist",
  "module_enabled",
  "my_event_waitlist",
  "my_org_permissions",
  "register_for_event",
  "reinstate_membership",
  "reject_membership_request",
  "request_membership",
  "reserve_request",
  "revoke_role",
  "save_club_settings",
  "save_custom_role",
  "save_document",
  "save_writeup",
  "search_documents",
  "set_organization_status",
  "submit_feedback",
  "submit_flag",
  "suspend_membership",
  "withdraw_membership_request",

];

async function publicTables(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`,
  );
  return rows.map((r) => r.name);
}

describe("migrations on a clean database", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb();
  });

  it("create every foundation table", async () => {
    expect(await publicTables(db)).toEqual(EXPECTED_TABLES);
  });

  it("enable row level security on every public table", async () => {
    const { rows } = await db.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("give the anon role no privileges on any public table or view", async () => {
    const { rows } = await db.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'v')
          and (has_table_privilege('anon', c.oid, 'SELECT')
            or has_table_privilege('anon', c.oid, 'INSERT')
            or has_table_privilege('anon', c.oid, 'UPDATE')
            or has_table_privilege('anon', c.oid, 'DELETE'))`,
    );
    expect(rows).toEqual([]);
  });

  it("let authenticated execute only the allow-listed private functions", async () => {
    const { rows } = await db.query<{ name: string; anon: boolean; authed: boolean }>(
      `select p.proname as name,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' order by 1`,
    );
    expect(rows.filter((r) => r.anon)).toEqual([]);
    expect(rows.filter((r) => r.authed).map((r) => r.name)).toEqual(AUTHENTICATED_EXECUTABLE);
  });

  it("pin search_path on every security definer function", async () => {
    const { rows } = await db.query<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(rows).toEqual([]);
  });

  it("make every report view run with the caller's privileges", async () => {
    const { rows } = await db.query<{ name: string; options: string[] | null }>(
      `select c.relname as name, c.reloptions as options from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v' order by 1`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const view of rows) {
      expect(view.options, view.name).toContain("security_invoker=true");
    }
  });

  it("seed the same permission catalog the application uses", async () => {
    const { rows } = await db.query<{ key: string }>("select key from public.permissions order by key");
    expect(rows.map((r) => r.key)).toEqual([...PERMISSIONS].sort());
  });
});

describe("rollback scripts", () => {
  it("undo every migration (newest first) and the migrations re-apply cleanly afterwards", async () => {
    const db = await freshDb();
    for (const file of await listRollbacks()) {
      await db.exec(await readFile(path.join(ROLLBACK_DIR, file), "utf8"));
    }

    expect(await publicTables(db)).toEqual([]);
    const { rows } = await db.query("select 1 from pg_namespace where nspname = 'private'");
    expect(rows).toEqual([]);

    await applyMigrations(db);
    expect(await publicTables(db)).toEqual(EXPECTED_TABLES);
  });
});
