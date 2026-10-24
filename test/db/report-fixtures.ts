import type { PGlite } from "@electric-sql/pglite";
import { approve, createAuthUser, requestMembership, type Org, type World } from "./fixtures";
import { asUser } from "./harness";

interface Application {
  org: "A" | "B";
  outcome: "approved" | "rejected" | "pending";
  appliedOn: string; // ISO date
  hoursToReview?: number;
}

/**
 * Applications with fixed timestamps so report figures are exact.
 *
 * Together with buildWorld() (whose 3+3 requests are set to 0 h turnaround):
 *   alpha-society: 7 reviewed, avg 12.00 h, median 2.00 h, max 48 h; 7 active, 2 pending, 85.7 % approved
 *   beta-circle:   6 reviewed, avg  1.50 h, median 0.50 h, max  5 h; 5 active, 0 pending, 66.7 % approved
 */
export const APPLICATIONS: Application[] = [
  { org: "A", outcome: "approved", appliedOn: "2026-08-03", hoursToReview: 2 },
  { org: "A", outcome: "approved", appliedOn: "2026-08-10", hoursToReview: 10 },
  { org: "A", outcome: "approved", appliedOn: "2026-09-01", hoursToReview: 48 },
  { org: "A", outcome: "rejected", appliedOn: "2026-09-02", hoursToReview: 24 },
  { org: "A", outcome: "pending", appliedOn: "2026-09-20" },
  { org: "A", outcome: "pending", appliedOn: "2026-09-21" },
  { org: "B", outcome: "approved", appliedOn: "2026-08-15", hoursToReview: 5 },
  { org: "B", outcome: "rejected", appliedOn: "2026-09-05", hoursToReview: 1 },
  { org: "B", outcome: "rejected", appliedOn: "2026-09-06", hoursToReview: 3 },
];

export async function seedReportData(db: PGlite, w: World): Promise<void> {
  // World requests were approved instantly; pin them to exactly 0 h.
  await db.query("update public.membership_requests set reviewed_at = applied_at where reviewed_at is not null");

  for (const [i, app] of APPLICATIONS.entries()) {
    const org: Org = app.org === "A" ? w.orgA : w.orgB;
    const reviewer = app.org === "A" ? w.officerA : w.officerB;
    const user = await createAuthUser(db, { email: `applicant-${i}@example.test`, name: `Applicant ${i}` });
    const requestId = await requestMembership(db, user, org.slug);

    if (app.outcome === "approved") await approve(db, reviewer, requestId);
    if (app.outcome === "rejected") {
      await asUser(db, reviewer, (tx) =>
        tx.query("select private.reject_membership_request($1, 'Not eligible this term')", [requestId]),
      );
    }

    await db.query(
      `update public.membership_requests
          set applied_at  = $2::timestamptz,
              reviewed_at = case when reviewed_at is null then null
                                 else $2::timestamptz + make_interval(hours => $3) end
        where id = $1`,
      [requestId, `${app.appliedOn}T09:00:00Z`, app.hoursToReview ?? 0],
    );
  }
}
