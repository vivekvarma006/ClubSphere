import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { VerifiedActor } from "@/server/auth/actor";
import { assertPermission, loadOrgAccess } from "@/server/authz/org-access";
import { PERMISSIONS } from "@/server/authz/permissions";
import * as tables from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { queryRows, withUserContext } from "@/server/db/user-context";
import { AppError, handleServiceError } from "@/server/errors";
import {
  OrganizationBrandingSchema,
  OrganizationSettingsSchema,
} from "@/server/validation/organization-config";
import { OrganizationSlug } from "@/server/validation/inputs";

async function run<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    throw handleServiceError("administration", e);
  }
}
export async function getSettings(
  db: Database,
  actor: VerifiedActor,
  slug: string,
) {
  return run(() =>
    withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, OrganizationSlug.parse(slug));
      if (
        !access.permissions.has("org.settings.manage") &&
        !access.permissions.has("role.manage")
      )
        throw new AppError("FORBIDDEN", "Settings permission required.");
      const [organization] = await tx
        .select()
        .from(tables.organizations)
        .where(eq(tables.organizations.id, access.organization.id));
      return {
        organization: organization!,
        domains: await tx
          .select()
          .from(tables.organizationEmailDomains)
          .where(
            eq(
              tables.organizationEmailDomains.organizationId,
              access.organization.id,
            ),
          ),
        fields: await tx
          .select()
          .from(tables.organizationProfileFields)
          .where(
            eq(
              tables.organizationProfileFields.organizationId,
              access.organization.id,
            ),
          )
          .orderBy(tables.organizationProfileFields.position),
        roles: await tx
          .select()
          .from(tables.organizationRoles)
          .where(
            eq(tables.organizationRoles.organizationId, access.organization.id),
          ),
        grants: await tx
          .select()
          .from(tables.rolePermissions)
          .where(
            eq(tables.rolePermissions.organizationId, access.organization.id),
          ),
        canManageSettings: access.permissions.has("org.settings.manage"),
        canManageRoles: access.permissions.has("role.manage"),
        permissions: [...access.permissions],
      };
    }),
  );
}
const Question = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    label: z.string().trim().min(1).max(100),
    type: z.enum(["text", "long_text", "number", "select", "url"]),
    required: z.boolean(),
    options: z.array(z.string().min(1).max(200)).min(1).max(50).optional(),
  })
  .refine((f) => (f.type === "select") === Boolean(f.options), {
    message:
      "Select questions need options; other questions must omit options.",
  });
export async function saveSettings(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  input: unknown,
) {
  return run(async () => {
    const data = z
      .object({
        name: z.string().trim().min(2).max(120),
        policy: z.enum(["approval_required", "invite_only", "closed"]),
        branding: OrganizationBrandingSchema,
        settings: OrganizationSettingsSchema,
        domains: z
          .array(
            z
              .string()
              .toLowerCase()
              .regex(
                /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
              )
              .max(253),
          )
          .max(100),
        fields: z
          .array(Question)
          .max(50)
          .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, {
            message: "Question keys must be unique.",
          }),
      })
      .parse(input);
    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      assertPermission(access, "org.settings.manage");
      await tx.execute(
        sql`select private.save_club_settings(${access.organization.id}::uuid,${data.name},${data.policy},${JSON.stringify(data.branding)}::jsonb,${JSON.stringify(data.settings)}::jsonb,${JSON.stringify([...new Set(data.domains)])}::jsonb,${JSON.stringify(data.fields)}::jsonb)`,
      );
    });
  });
}
export async function saveCustomRole(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  input: unknown,
) {
  return run(async () => {
    const data = z
      .object({
        roleId: z.uuid().nullable(),
        key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
        name: z.string().trim().min(1).max(60),
        permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
      })
      .parse(input);
    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      assertPermission(access, "role.manage");
      if (data.permissions.some((p) => !access.permissions.has(p)))
        throw new AppError(
          "FORBIDDEN",
          "You can only grant permissions you hold.",
        );
      await tx.execute(
        sql`select private.save_custom_role(${access.organization.id}::uuid,${data.roleId}::uuid,${data.key},${data.name},array(select jsonb_array_elements_text(${JSON.stringify(data.permissions)}::jsonb)))`,
      );
    });
  });
}
export async function getAuditLog(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  before?: string,
) {
  return run(() =>
    withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      assertPermission(access, "audit.read");
      const cursor = before
        ? z.coerce.number().int().positive().parse(before)
        : null;
      return tx
        .select()
        .from(tables.auditLogs)
        .where(
          sql`${tables.auditLogs.organizationId}=${access.organization.id}::uuid and (${cursor}::bigint is null or ${tables.auditLogs.id}<${cursor}::bigint)`,
        )
        .orderBy(desc(tables.auditLogs.id))
        .limit(100);
    }),
  );
}
export async function isPlatformAdmin(db: Database, actor: VerifiedActor) {
  return withUserContext(db, actor, async (tx) => {
    const [row] = await queryRows(
      tx,
      sql`select private.is_platform_admin() as v`,
      z.object({ v: z.boolean() }),
    );
    return row?.v ?? false;
  });
}
export async function listAdminClubs(db: Database, actor: VerifiedActor) {
  return run(async () => {
    if (!(await isPlatformAdmin(db, actor)))
      throw new AppError("NOT_FOUND", "Page not found.");
    return withUserContext(db, actor, (tx) =>
      tx.select().from(tables.organizations).orderBy(tables.organizations.name),
    );
  });
}
export async function createClub(
  db: Database,
  actor: VerifiedActor,
  input: unknown,
) {
  return run(async () => {
    const data = z
      .object({
        slug: OrganizationSlug,
        name: z.string().trim().min(2).max(120),
        ownerId: z.uuid(),
      })
      .parse(input);
    if (!(await isPlatformAdmin(db, actor)))
      throw new AppError("FORBIDDEN", "Platform administration required.");
    return withUserContext(db, actor, (tx) =>
      tx.execute(
        sql`select private.create_organization(${data.slug},${data.name},${data.ownerId}::uuid)`,
      ),
    );
  });
}
export async function setClubStatus(
  db: Database,
  actor: VerifiedActor,
  id: string,
  status: string,
) {
  return run(async () => {
    const org = z.uuid().parse(id),
      value = z.enum(["active", "suspended"]).parse(status);
    if (!(await isPlatformAdmin(db, actor)))
      throw new AppError("FORBIDDEN", "Platform administration required.");
    return withUserContext(db, actor, (tx) =>
      tx.execute(
        sql`select private.set_organization_status(${org}::uuid,${value})`,
      ),
    );
  });
}

export async function deleteCustomRole(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  roleId: string,
) {
  return run(async () => {
    const id = z.uuid().parse(roleId);
    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      assertPermission(access, "role.manage");
      assertPermission(access, "role.assign");
      await tx.execute(
        sql`select private.delete_custom_role(${access.organization.id}::uuid,${id}::uuid)`,
      );
    });
  });
}
