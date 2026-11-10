import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { VerifiedActor } from "@/server/auth/actor";
import { assertPermission, loadOrgAccess } from "@/server/authz/org-access";
import { readReportCache, writeReportCache } from "@/server/cache/reports";
import type { Database } from "@/server/db/types";
import { queryRows, withUserContext } from "@/server/db/user-context";
import { AppError, handleServiceError } from "@/server/errors";
import { OrganizationSlug } from "@/server/validation/inputs";

const Count = z.number().int().nonnegative();
export const ContributionReport = z.object({
  generatedAt: z.iso.datetime({ offset: true }),
  summary: z.object({ members: Count, contributors: Count, inactive: Count,
    attendance: Count, tasks: Count, ctfPoints: Count, certificates: Count }),
  members: z.array(z.object({ userId: z.uuid(), displayName: z.string(),
    attended: Count, tasksCompleted: Count, ctfPoints: Count, certificates: Count,
    score: Count, rank: Count })),
});

export async function getContributionReport(db: Database, actor: VerifiedActor, organizationSlug: string) {
  try {
    const slug = OrganizationSlug.parse(organizationSlug);
    // Always authorize against live PostgreSQL, including on Redis hits.
    const scope = await withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      assertPermission(access, "analytics.read");
      const [config] = await queryRows(tx, sql`
        select private.module_enabled(id, 'analytics') as enabled, settings::text as settings
        from public.organizations where id = ${access.organization.id}::uuid`,
      z.object({ enabled: z.boolean(), settings: z.string() }));
      if (!config?.enabled) throw new AppError("NOT_FOUND", "Module not available in this club.");
      const version = createHash("sha256").update(JSON.stringify([
        [...access.permissions].sort(), config.settings,
      ])).digest("hex");
      return { org: access.organization.id, version };
    });
    const key = `${process.env.REDIS_KEY_PREFIX ?? "clubsphere"}:contributions:v1:${scope.org}:${actor.userId}:${scope.version}`;
    const cached = await readReportCache(key, ContributionReport);
    if (cached) return { ...cached, source: "redis" as const };
    const report = await withUserContext(db, actor, async (tx) => {
      const [row] = await queryRows(tx,
        sql`select private.contribution_report(${scope.org}::uuid) as report`,
        z.object({ report: ContributionReport }));
      if (!row) throw new Error("Report returned no row");
      return row.report;
    });
    await writeReportCache(key, report);
    return { ...report, source: "postgresql" as const };
  } catch (error) { throw handleServiceError("reports.contributions", error); }
}
