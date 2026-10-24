import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { verifiedActor, type VerifiedActor } from "@/server/auth/actor";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { AppError } from "@/server/errors";
import {
  listMyMemberships,
  listMyRequests,
  listPendingRequests,
  reinstateMember,
  reviewMembershipRequest,
  submitMembershipRequest,
  suspendMember,
} from "@/server/services/memberships";
import { getMembershipReports } from "@/server/services/reports";
import { createAuthUser, freshWorld, membershipId, type World } from "../db/fixtures";
import { seedReportData } from "../db/report-fixtures";

// The real service layer (Zod -> withUserContext -> RLS -> procedures),
// running on PGlite through Drizzle exactly as it runs on postgres.js.

let pg: PGlite;
let db: Database;
let w: World;
const as = (userId: string): VerifiedActor => verifiedActor(userId, null);

beforeEach(async () => {
  ({ db: pg, w } = await freshWorld());
  db = drizzle(pg, { schema });
});

async function appError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected an AppError");
}

describe("submitMembershipRequest", () => {
  it("creates a pending request and shows it on the applicant's status page", async () => {
    const { requestId } = await submitMembershipRequest(db, as(w.applicant), { organizationSlug: " Alpha-Society " });
    const mine = await listMyRequests(db, as(w.applicant));
    expect(mine).toMatchObject([{ id: requestId, organizationSlug: "alpha-society", status: "pending" }]);
  });

  it("rejects malformed input before touching the database", async () => {
    const err = await appError(submitMembershipRequest(db, as(w.applicant), { organizationSlug: "not a slug!" }));
    expect(err.code).toBe("INVALID_INPUT");
  });

  it("turns database rules into user-facing errors without leaking SQL", async () => {
    const err = await appError(submitMembershipRequest(db, as(w.unverified), { organizationSlug: "alpha-society" }));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.publicMessage).toBe("Verify your email address before requesting membership.");
    expect(err.publicMessage).not.toMatch(/select|private\.|params/i);
  });
});

describe("reviewer workflow", () => {
  it("lists the queue with keyset pagination and no duplicates across pages", async () => {
    const applicants = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => createAuthUser(pg, { email: `queue-${n}@example.test` })),
    );
    for (const id of applicants) await submitMembershipRequest(db, as(id), { organizationSlug: "alpha-society" });

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listPendingRequests(db, as(w.officerA), { organizationSlug: "alpha-society", limit: 2, cursor });
      seen.push(...page.items.map((i) => i.userId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(applicants));
  });

  it("forbids the queue to members without membership.review", async () => {
    const err = await appError(listPendingRequests(db, as(w.memberA), { organizationSlug: "alpha-society" }));
    expect(err.code).toBe("FORBIDDEN");
  });

  it("rejects a tampered cursor", async () => {
    const err = await appError(
      listPendingRequests(db, as(w.officerA), { organizationSlug: "alpha-society", cursor: "not-a-cursor" }),
    );
    expect(err.code).toBe("INVALID_INPUT");
  });

  it("approves, after which the applicant is an active member", async () => {
    const { requestId } = await submitMembershipRequest(db, as(w.applicant), { organizationSlug: "alpha-society" });
    const result = await reviewMembershipRequest(db, as(w.officerA), {
      decision: "approve",
      organizationSlug: "alpha-society",
      requestId,
    });
    expect(result.decision).toBe("approved");
    expect(await listMyMemberships(db, as(w.applicant))).toMatchObject([{ organizationSlug: "alpha-society", status: "active" }]);
  });

  it("refuses a request id replayed under another organization's route", async () => {
    const { requestId } = await submitMembershipRequest(db, as(w.applicant), { organizationSlug: "beta-circle" });
    // crossUser is an officer in alpha and tries to approve beta's request via alpha's route.
    const err = await appError(
      reviewMembershipRequest(db, as(w.crossUser), { decision: "approve", organizationSlug: "alpha-society", requestId }),
    );
    expect(err.code).toBe("NOT_FOUND");
  });

  it("maps a repeated approval to CONFLICT", async () => {
    const { requestId } = await submitMembershipRequest(db, as(w.applicant), { organizationSlug: "alpha-society" });
    const input = { decision: "approve" as const, organizationSlug: "alpha-society", requestId };
    await reviewMembershipRequest(db, as(w.officerA), input);
    expect((await appError(reviewMembershipRequest(db, as(w.ownerA), input))).code).toBe("CONFLICT");
  });

  it("suspends and reinstates through the service layer", async () => {
    const target = await membershipId(pg, w.orgA.id, w.memberA);
    await suspendMember(db, as(w.officerA), { organizationSlug: "alpha-society", membershipId: target, reason: "Inactive" });
    expect(await listMyMemberships(db, as(w.memberA))).toMatchObject([{ status: "suspended" }]);
    await reinstateMember(db, as(w.officerA), { organizationSlug: "alpha-society", membershipId: target });
    expect(await listMyMemberships(db, as(w.memberA))).toMatchObject([{ status: "active" }]);
  });

  it("cannot suspend another organization's member via its own route", async () => {
    const target = await membershipId(pg, w.orgB.id, w.memberB);
    const err = await appError(suspendMember(db, as(w.officerA), { organizationSlug: "alpha-society", membershipId: target }));
    expect(err.code).toBe("NOT_FOUND");
  });
});

describe("getMembershipReports", () => {
  it("returns the organization's reports to an officer", async () => {
    await seedReportData(pg, w);
    const reports = await getMembershipReports(db, as(w.officerA), "alpha-society");
    expect(reports.summary).toMatchObject({ activeMembers: 7, pendingRequests: 2, approvalRatePct: "85.7" });
    expect(reports.turnaround).toMatchObject({ reviewedRequests: 7, avgHoursToReview: "12.00" });
    expect(reports.roles.map((r) => r.roleKey)).toEqual(["member", "officer", "owner"]);
  });

  it("is forbidden without analytics.read", async () => {
    expect((await appError(getMembershipReports(db, as(w.memberA), "alpha-society"))).code).toBe("FORBIDDEN");
  });
});
