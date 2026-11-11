import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import type { VerifiedActor } from "@/server/auth/actor";
import { assertPermission, loadOrgAccess } from "@/server/authz/org-access";
import {
  reportEventAttendance,
  reportMonthlyApplications,
  reportOrgMembershipSummary,
  reportReviewTurnaround,
  reportRoleDistribution,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { withUserContext } from "@/server/db/user-context";
import { handleServiceError } from "@/server/errors";
import { OrganizationSlug } from "@/server/validation/inputs";

import { readActivityCalendar } from "./activity-calendar";

/**
 * Organization reports (membership and event attendance), read from the
 * security_invoker views in 20261024000900_reports.sql and
 * 20261103001100_events_and_attendance.sql. Requires analytics.read; RLS
 * additionally limits the underlying rows to the caller's organization.
 */
export async function getMembershipReports(db: Database, actor: VerifiedActor, organizationSlug: string) {
  try {
    const slug = OrganizationSlug.parse(organizationSlug);
    return await withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      assertPermission(access, "analytics.read");
      const orgId = access.organization.id;

      const [summary] = await tx
        .select()
        .from(reportOrgMembershipSummary)
        .where(eq(reportOrgMembershipSummary.organizationId, orgId));
      const [turnaround] = await tx
        .select()
        .from(reportReviewTurnaround)
        .where(eq(reportReviewTurnaround.organizationId, orgId));
      const roles = await tx
        .select()
        .from(reportRoleDistribution)
        .where(eq(reportRoleDistribution.organizationId, orgId))
        .orderBy(asc(reportRoleDistribution.roleKey));
      const monthly = await tx
        .select()
        .from(reportMonthlyApplications)
        .where(eq(reportMonthlyApplications.organizationId, orgId))
        .orderBy(asc(reportMonthlyApplications.month));

      const events = await tx
        .select()
        .from(reportEventAttendance)
        .where(eq(reportEventAttendance.organizationId, orgId))
        .orderBy(desc(reportEventAttendance.startsAt))
        .limit(20);

      const calendar = await readActivityCalendar(tx, actor, orgId);
      return { calendar, organization: access.organization, summary: summary ?? null, turnaround: turnaround ?? null, roles, monthly, events };
    });
  } catch (error) {
    throw handleServiceError("reports.membership", error);
  }
}
