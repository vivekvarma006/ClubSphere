import "server-only";
import { reserveRequest } from "@/server/rate-limit";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { VerifiedActor } from "@/server/auth/actor";
import { assertPermission, loadOrgAccess } from "@/server/authz/org-access";
import { membershipRequests, membershipRoles, organizationRoles, organizationMemberships, organizations, profiles } from "@/server/db/schema";
import type { Database, DbTransaction } from "@/server/db/types";
import { queryRows, withUserContext } from "@/server/db/user-context";
import { AppError, handleServiceError } from "@/server/errors";
import {
  ListPendingRequestsInput,
  ReinstateMemberInput,
  ReviewMembershipRequestInput,
  SubmitMembershipRequestInput,
  SuspendMemberInput,
  WithdrawMembershipRequestInput,
} from "@/server/validation/inputs";

/**
 * Membership use cases. Each function:
 *   1. takes a VerifiedActor (identity already verified)
 *   2. validates input with Zod
 *   3. opens a user-context transaction (RLS + auth.uid() apply)
 *   4. resolves the organization from its slug and checks permission
 *   5. calls the database procedure, which re-checks authorization under a
 *      row lock and writes audit rows in the same transaction
 *
 * Steps 4 and 5 deliberately overlap: the application check gives fast,
 * clear errors; the database check is the one that cannot be bypassed.
 */

const IdRow = z.object({ v: z.uuid() });
const OrgIdRow = z.object({ organization_id: z.uuid() });

async function run<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw handleServiceError(operation, error);
  }
}

// ---------------------------------------------------------------------------
// Applicant side
// ---------------------------------------------------------------------------

export async function submitMembershipRequest(
  db: Database,
  actor: VerifiedActor,
  input: SubmitMembershipRequestInput,
): Promise<{ requestId: string }> {
  return run("membership.request", async () => {
    await reserveRequest(db, actor, "membership");
    const { organizationSlug, answers } = SubmitMembershipRequestInput.parse(input);
    return withUserContext(db, actor, async (tx) => {
      const [row] = await queryRows(
        tx,
        sql`select private.request_membership(${organizationSlug}, ${JSON.stringify(answers)}::jsonb) as v`,
        IdRow,
      );
      if (!row) throw new Error("request_membership returned no row");
      return { requestId: row.v };
    });
  });
}

export async function withdrawMembershipRequest(
  db: Database,
  actor: VerifiedActor,
  input: z.input<typeof WithdrawMembershipRequestInput>,
): Promise<void> {
  return run("membership.withdraw", async () => {
    const { requestId } = WithdrawMembershipRequestInput.parse(input);
    await withUserContext(db, actor, (tx) =>
      tx.execute(sql`select private.withdraw_membership_request(${requestId}::uuid)`),
    );
  });
}

export interface MyMembership {
  organizationSlug: string;
  organizationName: string;
  status: "active" | "suspended";
  joinedAt: Date;
}

export async function listMyMemberships(db: Database, actor: VerifiedActor): Promise<MyMembership[]> {
  return run("membership.list_mine", () =>
    withUserContext(db, actor, (tx) =>
      tx
        .select({
          organizationSlug: organizations.slug,
          organizationName: organizations.name,
          status: organizationMemberships.status,
          joinedAt: organizationMemberships.joinedAt,
        })
        .from(organizationMemberships)
        .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
        .where(eq(organizationMemberships.userId, actor.userId))
        .orderBy(asc(organizations.name)),
    ),
  );
}

export interface MyRequest {
  id: string;
  organizationSlug: string;
  organizationName: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  appliedAt: Date;
  reviewedAt: Date | null;
  rejectionReason: string | null;
}

export async function listMyRequests(db: Database, actor: VerifiedActor): Promise<MyRequest[]> {
  return run("membership.list_my_requests", () =>
    withUserContext(db, actor, (tx) =>
      tx
        .select({
          id: membershipRequests.id,
          organizationSlug: organizations.slug,
          organizationName: organizations.name,
          status: membershipRequests.status,
          appliedAt: membershipRequests.appliedAt,
          reviewedAt: membershipRequests.reviewedAt,
          rejectionReason: membershipRequests.rejectionReason,
        })
        .from(membershipRequests)
        .innerJoin(organizations, eq(organizations.id, membershipRequests.organizationId))
        .where(eq(membershipRequests.userId, actor.userId))
        .orderBy(sql`${membershipRequests.appliedAt} desc`)
        .limit(50),
    ),
  );
}

// ---------------------------------------------------------------------------
// Reviewer side
// ---------------------------------------------------------------------------

export interface PendingRequest {
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  appliedAt: Date;
  answers: Record<string, unknown>;
}

// Keyset pagination cursor: the (applied_at, id) of the last row shown.
// applied_at travels as Postgres text so microsecond precision survives the
// round trip (a JS Date would truncate to milliseconds and repeat rows).
const Cursor = z.object({ a: z.string().min(10).max(64), i: z.uuid() });

function encodeCursor(appliedAtText: string, id: string): string {
  return Buffer.from(JSON.stringify({ a: appliedAtText, i: id })).toString("base64url");
}

function decodeCursor(cursor: string): z.infer<typeof Cursor> {
  try {
    return Cursor.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new AppError("INVALID_INPUT", "Invalid page cursor.");
  }
}

export async function listPendingRequests(
  db: Database,
  actor: VerifiedActor,
  input: ListPendingRequestsInput,
): Promise<{ items: PendingRequest[]; nextCursor: string | null }> {
  return run("membership.list_pending", async () => {
    const { organizationSlug, cursor, limit } = ListPendingRequestsInput.parse(input);
    const after = cursor ? decodeCursor(cursor) : null;

    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, organizationSlug);
      assertPermission(access, "membership.review");

      const rows = await tx
        .select({
          id: membershipRequests.id,
          userId: membershipRequests.userId,
          displayName: profiles.displayName,
          email: profiles.email,
          appliedAt: membershipRequests.appliedAt,
          appliedAtText: sql<string>`${membershipRequests.appliedAt}::text`,
          answers: membershipRequests.answers,
        })
        .from(membershipRequests)
        .innerJoin(profiles, eq(profiles.id, membershipRequests.userId))
        .where(
          and(
            eq(membershipRequests.organizationId, access.organization.id),
            eq(membershipRequests.status, "pending"),
            after
              ? sql`(${membershipRequests.appliedAt}, ${membershipRequests.id}) > (${after.a}::timestamptz, ${after.i}::uuid)`
              : undefined,
          ),
        )
        .orderBy(asc(membershipRequests.appliedAt), asc(membershipRequests.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({
          id: row.id,
          userId: row.userId,
          displayName: row.displayName,
          email: row.email,
          appliedAt: row.appliedAt,
          answers: row.answers,
        })),
        nextCursor: rows.length > limit && last ? encodeCursor(last.appliedAtText, last.id) : null,
      };
    });
  });
}

/** Confirms a row belongs to the organization named in the URL, so a request id cannot be replayed under another club's route. */
async function assertBelongsToOrg(
  tx: DbTransaction,
  table: "membership_requests" | "organization_memberships",
  id: string,
  organizationId: string,
  notFoundMessage: string,
): Promise<void> {
  const target =
    table === "membership_requests"
      ? sql`select organization_id from public.membership_requests where id = ${id}::uuid`
      : sql`select organization_id from public.organization_memberships where id = ${id}::uuid`;
  const [row] = await queryRows(tx, target, OrgIdRow);
  if (!row || row.organization_id !== organizationId) throw new AppError("NOT_FOUND", notFoundMessage);
}

export async function reviewMembershipRequest(
  db: Database,
  actor: VerifiedActor,
  input: ReviewMembershipRequestInput,
): Promise<{ decision: "approved"; membershipId: string } | { decision: "rejected" }> {
  return run("membership.review", async () => {
    const parsed = ReviewMembershipRequestInput.parse(input);

    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, parsed.organizationSlug);
      assertPermission(access, "membership.review");
      await assertBelongsToOrg(tx, "membership_requests", parsed.requestId, access.organization.id, "Membership request not found.");

      if (parsed.decision === "approve") {
        const [row] = await queryRows(
          tx,
          sql`select private.approve_membership_request(${parsed.requestId}::uuid) as v`,
          IdRow,
        );
        if (!row) throw new Error("approve_membership_request returned no row");
        return { decision: "approved" as const, membershipId: row.v };
      }

      await tx.execute(
        sql`select private.reject_membership_request(${parsed.requestId}::uuid, ${parsed.reason ?? null}::text)`,
      );
      return { decision: "rejected" as const };
    });
  });
}

export async function suspendMember(db: Database, actor: VerifiedActor, input: SuspendMemberInput): Promise<void> {
  return run("membership.suspend", async () => {
    const { organizationSlug, membershipId, reason } = SuspendMemberInput.parse(input);
    await withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, organizationSlug);
      assertPermission(access, "membership.suspend");
      await assertBelongsToOrg(tx, "organization_memberships", membershipId, access.organization.id, "Member not found.");
      await tx.execute(sql`select private.suspend_membership(${membershipId}::uuid, ${reason ?? null}::text)`);
    });
  });
}

export async function reinstateMember(db: Database, actor: VerifiedActor, input: ReinstateMemberInput): Promise<void> {
  return run("membership.reinstate", async () => {
    const { organizationSlug, membershipId } = ReinstateMemberInput.parse(input);
    await withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, organizationSlug);
      assertPermission(access, "membership.suspend");
      await assertBelongsToOrg(tx, "organization_memberships", membershipId, access.organization.id, "Member not found.");
      await tx.execute(sql`select private.reinstate_membership(${membershipId}::uuid)`);
    });
  });
}


export async function listMembers(
  db: Database,
  actor: VerifiedActor,
  organizationSlug: string,
) {
  return run("membership.list", () =>
    withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, organizationSlug);
      assertPermission(access, "member.read");
      const members = await tx
        .select({
          id: organizationMemberships.id,
          userId: profiles.id,
          displayName: profiles.displayName,
          email: profiles.email,
          status: organizationMemberships.status,
        })
        .from(organizationMemberships)
        .innerJoin(profiles, eq(profiles.id, organizationMemberships.userId))
        .where(
          eq(organizationMemberships.organizationId, access.organization.id),
        )
        .orderBy(asc(profiles.displayName));
      const roles = await tx
        .select({ id: organizationRoles.id, name: organizationRoles.name })
        .from(organizationRoles)
        .where(eq(organizationRoles.organizationId, access.organization.id));
      const assigned = await tx
        .select()
        .from(membershipRoles)
        .where(eq(membershipRoles.organizationId, access.organization.id));
      return {
        members: members.map((m) => ({
          ...m,
          roleIds: assigned
            .filter((r) => r.membershipId === m.id)
            .map((r) => r.roleId),
        })),
        roles,
        canSuspend: access.permissions.has("membership.suspend"),
        canAssign: access.permissions.has("role.assign"),
      };
    }),
  );
}

export async function changeMemberRole(
  db: Database,
  actor: VerifiedActor,
  input: {
    organizationSlug: string;
    membershipId: string;
    roleId: string;
    revoke: boolean;
  },
) {
  return run("membership.role", async () => {
    const membershipId = z.uuid().parse(input.membershipId);
    const roleId = z.uuid().parse(input.roleId);
    await withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, input.organizationSlug);
      assertPermission(access, "role.assign");
      await assertBelongsToOrg(
        tx,
        "organization_memberships",
        membershipId,
        access.organization.id,
        "Member not found.",
      );
      const [role] = await tx
        .select({ id: organizationRoles.id })
        .from(organizationRoles)
        .where(
          and(
            eq(organizationRoles.id, roleId),
            eq(organizationRoles.organizationId, access.organization.id),
          ),
        );
      if (!role) throw new AppError("NOT_FOUND", "Role not found.");
      await tx.execute(
        input.revoke
          ? sql`select private.revoke_role(${membershipId}::uuid, ${roleId}::uuid)`
          : sql`select private.assign_role(${membershipId}::uuid, ${roleId}::uuid)`,
      );
    });
  });
}
