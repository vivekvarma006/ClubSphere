import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { freshWorld, type World } from "./fixtures";
import { asUser } from "./harness";
import { APPLICATIONS, seedReportData } from "./report-fixtures";

let db: PGlite;
let w: World;

beforeAll(async () => {
  ({ db, w } = await freshWorld());
  await seedReportData(db, w);
});

const report = async <T>(actor: string, sql: string) => (await asUser(db, actor, (tx) => tx.query<T>(sql))).rows;

describe("report_org_membership_summary", () => {
  it("gives each organization's owner exact figures for their organization only", async () => {
    const rows = await report(w.ownerA, "select * from public.report_org_membership_summary");
    expect(rows).toEqual([
      {
        organization_id: w.orgA.id,
        slug: "alpha-society",
        name: "Alpha Society",
        active_members: 7,
        suspended_members: 0,
        pending_requests: 2,
        approved_requests: 6,
        rejected_requests: 1,
        approval_rate_pct: "85.7",
      },
    ]);
  });

  it("returns nothing to members without analytics.read", async () => {
    expect(await report(w.memberA, "select * from public.report_org_membership_summary")).toEqual([]);
  });

  it("follows the person's role in each organization", async () => {
    // crossUser is an officer (analytics.read) in A, a plain member in B.
    const rows = await report<{ slug: string }>(w.crossUser, "select slug from public.report_org_membership_summary");
    expect(rows).toEqual([{ slug: "alpha-society" }]);
  });
});

describe("report_review_turnaround (average per organization)", () => {
  it("computes average, median and max hours to review", async () => {
    const a = await report(w.officerA, "select reviewed_requests, avg_hours_to_review, median_hours_to_review, max_hours_to_review from public.report_review_turnaround");
    const b = await report(w.officerB, "select reviewed_requests, avg_hours_to_review, median_hours_to_review, max_hours_to_review from public.report_review_turnaround");
    expect(a).toEqual([{ reviewed_requests: 7, avg_hours_to_review: "12.00", median_hours_to_review: "2.00", max_hours_to_review: "48.00" }]);
    expect(b).toEqual([{ reviewed_requests: 6, avg_hours_to_review: "1.50", median_hours_to_review: "0.50", max_hours_to_review: "5.00" }]);
  });
});

describe("report_role_distribution", () => {
  it("counts active members per role, including empty roles", async () => {
    const rows = await report<{ role_key: string; active_members: number }>(
      w.ownerA,
      "select role_key, active_members from public.report_role_distribution order by role_key",
    );
    expect(rows).toEqual([
      { role_key: "member", active_members: 6 },
      { role_key: "officer", active_members: 2 },
      { role_key: "owner", active_members: 1 },
    ]);
  });
});

describe("report_monthly_applications", () => {
  it("buckets applications by month", async () => {
    const rows = await report<{ month: Date; applications: number }>(
      w.ownerA,
      "select month, applications from public.report_monthly_applications where month < date '2026-10-01' order by month",
    );
    const seededForA = APPLICATIONS.filter((a) => a.org === "A");
    expect(rows.map((r) => r.applications)).toEqual([
      seededForA.filter((a) => a.appliedOn.startsWith("2026-08")).length,
      seededForA.filter((a) => a.appliedOn.startsWith("2026-09")).length,
    ]);
  });
});
