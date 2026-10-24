import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { queryRows } from "@/server/db/user-context";
import type { DbTransaction } from "@/server/db/types";
import { AppError } from "@/server/errors";
import { isPermission, type Permission } from "./permissions";

export interface OrgAccess {
  organization: { id: string; slug: string; name: string; status: string };
  /** The caller's effective permissions here: empty unless an ACTIVE member of an ACTIVE organization. */
  permissions: ReadonlySet<Permission>;
}

const OrgAccessRow = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  permissions: z.array(z.string()),
});

/**
 * Steps 2-3 of every protected operation: resolve the organization from a
 * trusted identifier (the slug in the URL, looked up server-side, never an
 * organization id from the request body) and load what the caller may do
 * there. Must run inside withUserContext so RLS and auth.uid() apply.
 */
export async function loadOrgAccess(tx: DbTransaction, organizationSlug: string): Promise<OrgAccess> {
  const [row] = await queryRows(
    tx,
    sql`select o.id, o.slug, o.name, o.status, private.my_org_permissions(o.id) as permissions
          from public.organizations o
         where o.slug = ${organizationSlug}`,
    OrgAccessRow,
  );
  if (!row) throw new AppError("NOT_FOUND", "Organization not found.");

  return {
    organization: { id: row.id, slug: row.slug, name: row.name, status: row.status },
    permissions: new Set(row.permissions.filter(isPermission)),
  };
}

/** Step 4: check the required permission. */
export function assertPermission(access: OrgAccess, permission: Permission): void {
  if (!access.permissions.has(permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission to do that in this organization.");
  }
}
