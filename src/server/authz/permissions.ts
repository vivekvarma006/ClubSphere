/**
 * Capability keys understood by ClubSphere. Mirrors `public.permissions`
 * (seeded in supabase/migrations/20261024000500_roles_and_permissions.sql);
 * test/db/migrations.test.ts fails if the two drift apart.
 *
 * Authorization checks name a permission, never a role, so clubs can rename
 * roles or define their own without code changes.
 *
 * Convention for new modules: add the key here AND register it in the
 * module's migration with private.register_permission(key, description,
 * default_roles), which also backfills existing organizations.
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
  "event.manage",
  "event.checkin",
  "document.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
