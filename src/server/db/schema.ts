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
  customType,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgView,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export type MembershipRequestStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type MembershipStatus = "active" | "suspended";
export type OrganizationStatus = "active" | "suspended" | "archived";
export type OnboardingPolicy = "approval_required" | "invite_only" | "closed";
export type ProfileFieldType = "text" | "long_text" | "number" | "select" | "url";
export type EventCategory = "workshop" | "hackathon" | "ctf" | "talk" | "competition" | "social" | "recruitment" | "other";
export type EventStatus = "draft" | "published" | "completed" | "cancelled";
export type RegistrationStatus = "registered" | "cancelled";
export type DocumentSourceType = "event_doc" | "guide" | "writeup" | "feedback" | "minutes";
export type DocumentVisibility = "members" | "officers";

/** Generated full-text column; read-only from the application. */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

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

export const roleTemplates = pgTable("role_templates", {
  roleKey: text("role_key").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  isDefault: boolean("is_default").notNull(),
  grantsAll: boolean("grants_all").notNull(),
  position: smallint("position").notNull(),
});

export const roleTemplatePermissions = pgTable(
  "role_template_permissions",
  {
    roleKey: text("role_key").notNull(),
    permissionKey: text("permission_key").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleKey, t.permissionKey] })],
);

// ---------------------------------------------------------------------------
// Events and attendance (20261103001100_events_and_attendance.sql)
// ---------------------------------------------------------------------------

export const events = pgTable("events", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").$type<EventCategory>().notNull(),
  venue: text("venue"),
  startsAt: timestamptz("starts_at").notNull(),
  endsAt: timestamptz("ends_at").notNull(),
  capacity: integer("capacity"),
  status: text("status").$type<EventStatus>().notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamptz("created_at").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});

export const eventRegistrations = pgTable("event_registrations", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  eventId: uuid("event_id").notNull(),
  userId: uuid("user_id").notNull(),
  status: text("status").$type<RegistrationStatus>().notNull(),
  registeredAt: timestamptz("registered_at").notNull(),
  cancelledAt: timestamptz("cancelled_at"),
});

export const registrationCredentials = pgTable("registration_credentials", {
  registrationId: uuid("registration_id").primaryKey(),
  token: text("token").notNull(),
  issuedAt: timestamptz("issued_at").notNull(),
});

export const eventAttendance = pgTable("event_attendance", {
  registrationId: uuid("registration_id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  eventId: uuid("event_id").notNull(),
  checkedInAt: timestamptz("checked_in_at").notNull(),
  checkedInBy: uuid("checked_in_by"),
});

// ---------------------------------------------------------------------------
// Knowledge base (20261103001200_knowledge_base.sql)
// ---------------------------------------------------------------------------

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  title: text("title").notNull(),
  sourceType: text("source_type").$type<DocumentSourceType>().notNull(),
  eventId: uuid("event_id"),
  body: text("body").notNull(),
  visibility: text("visibility").$type<DocumentVisibility>().notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamptz("created_at").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});

export const documentChunks = pgTable("document_chunks", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  documentId: uuid("document_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 256 }).notNull(),
  embeddingModel: text("embedding_model").notNull(),
  fts: tsvector("fts"),
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

export const reportEventAttendance = pgView("report_event_attendance", {
  organizationId: uuid("organization_id").notNull(),
  eventId: uuid("event_id").notNull(),
  title: text("title").notNull(),
  category: text("category").$type<EventCategory>().notNull(),
  startsAt: timestamptz("starts_at").notNull(),
  status: text("status").$type<EventStatus>().notNull(),
  capacity: integer("capacity"),
  registered: bigint("registered", { mode: "number" }).notNull(),
  attended: bigint("attended", { mode: "number" }).notNull(),
  attendanceRatePct: numeric("attendance_rate_pct"),
  fillRatePct: numeric("fill_rate_pct"),
}).existing();

// Remaining product modules (migrations 1300–1900).
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull(),
});
export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  itemId: uuid("item_id").notNull(),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamptz("created_at").notNull(),
});
export const mealSlots = pgTable("meal_slots", {
  id: uuid("id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  eventId: uuid("event_id").notNull(),
  itemId: uuid("item_id").notNull(),
  name: text("name").notNull(),
});
export const foodClaims = pgTable("food_claims", {
  organizationId: uuid("organization_id").notNull(),
  eventId: uuid("event_id").notNull(),
  registrationId: uuid("registration_id").notNull(),
  mealSlotId: uuid("meal_slot_id").notNull(),
  claimedAt: timestamptz("claimed_at").notNull(),
  claimedBy: uuid("claimed_by"),
});
export const volunteerTasks = pgTable("volunteer_tasks", {
  id: uuid("id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  eventId: uuid("event_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  dueAt: timestamptz("due_at"),
  createdAt: timestamptz("created_at").notNull(),
});
export const taskAssignments = pgTable("task_assignments", {
  organizationId: uuid("organization_id").notNull(),
  taskId: uuid("task_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  assignedAt: timestamptz("assigned_at").notNull(),
  completedAt: timestamptz("completed_at"),
});
export const ctfChallenges = pgTable("ctf_challenges", {
  id: uuid("id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  eventId: uuid("event_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  points: integer("points").notNull(),
  flagHash: bytea("flag_hash").notNull(),
});
export const ctfAttempts = pgTable("ctf_attempts", {
  id: uuid("id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  challengeId: uuid("challenge_id").notNull(),
  userId: uuid("user_id").notNull(),
  correct: boolean("correct").notNull(),
  attemptedAt: timestamptz("attempted_at").notNull(),
});
export const ctfSolves = pgTable("ctf_solves", {
  organizationId: uuid("organization_id").notNull(),
  challengeId: uuid("challenge_id").notNull(),
  userId: uuid("user_id").notNull(),
  solvedAt: timestamptz("solved_at").notNull(),
  points: integer("points").notNull(),
  documentId: uuid("document_id"),
});
export const certificates = pgTable("certificates", {
  id: uuid("id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  eventId: uuid("event_id").notNull(),
  registrationId: uuid("registration_id").notNull(),
  userId: uuid("user_id").notNull(),
  verificationCode: text("verification_code").notNull(),
  recipientName: text("recipient_name").notNull(),
  eventTitle: text("event_title").notNull(),
  organizationName: text("organization_name").notNull(),
  issuedAt: timestamptz("issued_at").notNull(),
});
export const eventFeedback = pgTable("event_feedback", {
  id: uuid("id").notNull(),
  organizationId: uuid("organization_id").notNull(),
  eventId: uuid("event_id").notNull(),
  userId: uuid("user_id").notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull(),
  documentId: uuid("document_id").notNull(),
  createdAt: timestamptz("created_at").notNull(),
});
export const ctfScoreboard = pgView("ctf_scoreboard", {
  organizationId: uuid("organization_id"),
  eventId: uuid("event_id"),
  userId: uuid("user_id"),
  points: bigint("points", { mode: "number" }),
  rank: bigint("rank", { mode: "number" }),
}).existing();
export const reportMemberContributions = pgView("report_member_contributions", {
  organizationId: uuid("organization_id"),
  userId: uuid("user_id"),
  displayName: text("display_name"),
  attended: bigint("attended", { mode: "number" }),
  tasksCompleted: bigint("tasks_completed", { mode: "number" }),
  ctfPoints: bigint("ctf_points", { mode: "number" }),
  certificates: bigint("certificates", { mode: "number" }),
  score: bigint("score", { mode: "number" }),
  rank: bigint("rank", { mode: "number" }),
}).existing();
