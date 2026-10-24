/**
 * Capability keys understood by ClubSphere. Mirrors `public.permissions`
 * (seeded in supabase/migrations/20261024000500_roles_and_permissions.sql);
 * test/db/migrations.test.ts fails if the two drift apart.
 *
 * Authorization checks name a permission, never a role, so clubs can rename
 * roles or define their own without code changes.
 *
 * Convention for new modules: add the key here AND insert it in the module's
 * migration, granting it to every existing owner role in the same migration.
 */
export const PERMISSIONS = [
  "org.settings.manage",
  "member.read",
  "membership.review",
  "membership.suspend",
  "role.assign",
  "role.manage",
  "audit.read",
  "analytics.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
