/**
 * Typed mirror of the tables created by supabase/migrations/*.sql.
 *
 * The SQL migrations are the source of truth: constraints, triggers, RLS
 * and procedures live there. This file only gives Drizzle the column names
 * and types for type-safe queries. test/db/schema-drift.test.ts fails if a
 * table or column here does not match the migrated database.
 */
import {
  bigint,
  boolean,
  date,
  jsonb,
  numeric,
  pgTable,
  pgView,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export type MembershipRequestStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type MembershipStatus = "active" | "suspended";
export type OrganizationStatus = "active" | "suspended" | "archived";
export type OnboardingPolicy = "approval_required" | "invite_only" | "closed";
export type ProfileFieldType = "text" | "long_text" | "number" | "select" | "url";

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email"),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamptz("created_at").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});

export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id").primaryKey(),
  grantedBy: uuid("granted_by"),
  grantedAt: timestamptz("granted_at").notNull(),
  note: text("note"),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  status: text("status").$type<OrganizationStatus>().notNull(),
  onboardingPolicy: text("onboarding_policy").$type<OnboardingPolicy>().notNull(),
  branding: jsonb("branding").$type<Record<string, unknown>>().notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamptz("created_at").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});

export const organizationEmailDomains = pgTable(
  "organization_email_domains",
  {
    organizationId: uuid("organization_id").notNull(),
    domain: text("domain").notNull(),
    createdAt: timestamptz("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.domain] })],
);

export const organizationProfileFields = pgTable("organization_profile_fields", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  fieldKey: text("field_key").notNull(),
  label: text("label").notNull(),
  fieldType: text("field_type").$type<ProfileFieldType>().notNull(),
  isRequired: boolean("is_required").notNull(),
  options: jsonb("options").$type<string[] | null>(),
  position: smallint("position").notNull(),
  createdAt: timestamptz("created_at").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
});

export const organizationRoles = pgTable("organization_roles", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  roleKey: text("role_key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull(),
  isDefault: boolean("is_default").notNull(),
  createdAt: timestamptz("created_at").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    organizationId: uuid("organization_id").notNull(),
    roleId: uuid("role_id").notNull(),
    permissionKey: text("permission_key").notNull(),
    grantedAt: timestamptz("granted_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const membershipRequests = pgTable("membership_requests", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  userId: uuid("user_id").notNull(),
  status: text("status").$type<MembershipRequestStatus>().notNull(),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
  appliedAt: timestamptz("applied_at").notNull(),
  reviewedAt: timestamptz("reviewed_at"),
  reviewedBy: uuid("reviewed_by"),
  rejectionReason: text("rejection_reason"),
  withdrawnAt: timestamptz("withdrawn_at"),
  updatedAt: timestamptz("updated_at").notNull(),
});

export const organizationMemberships = pgTable("organization_memberships", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  userId: uuid("user_id").notNull(),
  status: text("status").$type<MembershipStatus>().notNull(),
  joinedAt: timestamptz("joined_at").notNull(),
  sourceRequestId: uuid("source_request_id"),
  suspendedAt: timestamptz("suspended_at"),
  suspendedBy: uuid("suspended_by"),
  suspensionReason: text("suspension_reason"),
  updatedAt: timestamptz("updated_at").notNull(),
});

export const membershipRoles = pgTable(
  "membership_roles",
  {
    organizationId: uuid("organization_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    roleId: uuid("role_id").notNull(),
    assignedAt: timestamptz("assigned_at").notNull(),
    assignedBy: uuid("assigned_by"),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.roleId] })],
);

export const auditLogs = pgTable("audit_logs", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  occurredAt: timestamptz("occurred_at").notNull(),
  actorId: uuid("actor_id"),
  organizationId: uuid("organization_id"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
});

// ---------------------------------------------------------------------------
// Report views (security_invoker; defined in 20261024000900_reports.sql)
// ---------------------------------------------------------------------------

export const reportOrgMembershipSummary = pgView("report_org_membership_summary", {
  organizationId: uuid("organization_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  activeMembers: bigint("active_members", { mode: "number" }).notNull(),
  suspendedMembers: bigint("suspended_members", { mode: "number" }).notNull(),
  pendingRequests: bigint("pending_requests", { mode: "number" }).notNull(),
  approvedRequests: bigint("approved_requests", { mode: "number" }).notNull(),
  rejectedRequests: bigint("rejected_requests", { mode: "number" }).notNull(),
  approvalRatePct: numeric("approval_rate_pct"),
}).existing();

export const reportReviewTurnaround = pgView("report_review_turnaround", {
  organizationId: uuid("organization_id").notNull(),
  slug: text("slug").notNull(),
  reviewedRequests: bigint("reviewed_requests", { mode: "number" }).notNull(),
  avgHoursToReview: numeric("avg_hours_to_review"),
  medianHoursToReview: numeric("median_hours_to_review"),
  maxHoursToReview: numeric("max_hours_to_review"),
}).existing();

export const reportRoleDistribution = pgView("report_role_distribution", {
  organizationId: uuid("organization_id").notNull(),
  roleKey: text("role_key").notNull(),
  roleName: text("role_name").notNull(),
  activeMembers: bigint("active_members", { mode: "number" }).notNull(),
}).existing();

export const reportMonthlyApplications = pgView("report_monthly_applications", {
  organizationId: uuid("organization_id").notNull(),
  month: date("month", { mode: "string" }).notNull(),
  applications: bigint("applications", { mode: "number" }).notNull(),
  approved: bigint("approved", { mode: "number" }).notNull(),
  rejected: bigint("rejected", { mode: "number" }).notNull(),
  stillPending: bigint("still_pending", { mode: "number" }).notNull(),
}).existing();
