import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { approve, createAuthUser, freshWorld, requestMembership, type World } from "./fixtures";
import { asAnon, asUser, pgError, scalar } from "./harness";

let db: PGlite;
let w: World;

beforeEach(async () => {
  ({ db, w } = await freshWorld());
});

const requestRow = (id: string) =>
  db.query<{ status: string; reviewed_by: string | null; rejection_reason: string | null }>(
    "select status, reviewed_by, rejection_reason from public.membership_requests where id = $1",
    [id],
  );

describe("signing up", () => {
  it("creates a profile but no membership, request or role", async () => {
    const id = await createAuthUser(db, { email: "new@example.test", name: "New Person" });
    const profile = await db.query<{ display_name: string }>("select display_name from public.profiles where id = $1", [id]);
    expect(profile.rows).toEqual([{ display_name: "New Person" }]);

    const counts = await db.query<{ m: number; r: number }>(
      `select (select count(*)::int from public.organization_memberships where user_id = $1) as m,
              (select count(*)::int from public.membership_requests where user_id = $1) as r`,
      [id],
    );
    expect(counts.rows[0]).toEqual({ m: 0, r: 0 });
  });
});

describe("requesting membership", () => {
  it("creates one pending request", async () => {
    const id = await requestMembership(db, w.applicant, w.orgA.slug);
    expect((await requestRow(id)).rows[0]?.status).toBe("pending");
  });

  it("is idempotent: a retry returns the same request instead of a duplicate", async () => {
    const first = await requestMembership(db, w.applicant, w.orgA.slug);
    const second = await requestMembership(db, w.applicant, w.orgA.slug);
    expect(second).toBe(first);
    const n = await scalar<number>(
      db,
      "select count(*)::int as v from public.membership_requests where user_id = $1",
      [w.applicant],
    );
    expect(n).toBe(1);
  });

  it("is independent per organization", async () => {
    const a = await requestMembership(db, w.applicant, w.orgA.slug);
    const b = await requestMembership(db, w.applicant, w.orgB.slug);
    expect(a).not.toBe(b);
  });

  it("rejects users whose email is not verified", async () => {
    const err = await pgError(requestMembership(db, w.unverified, w.orgA.slug));
    expect(err.code).toBe("CS403");
    expect(err.message).toMatch(/verify your email/);
  });

  it("rejects anonymous sessions", async () => {
    const anonUser = await createAuthUser(db, { email: "anon@example.test", anonymous: true });
    expect((await pgError(requestMembership(db, anonUser, w.orgA.slug))).code).toBe("CS401");
  });

  it("is not callable at all without a session", async () => {
    const err = await pgError(
      asAnon(db, (tx) => tx.query("select private.request_membership('alpha-society', '{}')")),
    );
    expect(err.code).toBe("42501"); // permission denied
  });

  it("rejects members who are already in the organization", async () => {
    expect((await pgError(requestMembership(db, w.memberA, w.orgA.slug))).code).toBe("CS409");
  });

  it("reports unknown and inactive organizations as not found", async () => {
    expect((await pgError(requestMembership(db, w.applicant, "no-such-club"))).code).toBe("CS404");
    await db.query("update public.organizations set status = 'suspended' where id = $1", [w.orgA.id]);
    expect((await pgError(requestMembership(db, w.applicant, w.orgA.slug))).code).toBe("CS404");
  });

  it.each(["invite_only", "closed"])("refuses requests when the onboarding policy is %s", async (policy) => {
    await db.query("update public.organizations set onboarding_policy = $1 where id = $2", [policy, w.orgA.id]);
    expect((await pgError(requestMembership(db, w.applicant, w.orgA.slug))).code).toBe("CS403");
  });

  describe("email-domain eligibility", () => {
    beforeEach(async () => {
      await db.query("insert into public.organization_email_domains (organization_id, domain) values ($1, 'campus.test')", [
        w.orgA.id,
      ]);
    });

    it("rejects verified emails from other domains", async () => {
      const err = await pgError(requestMembership(db, w.applicant, w.orgA.slug));
      expect(err.code).toBe("CS403");
      expect(err.message).toMatch(/domain/);
    });

    it("accepts verified emails from a listed domain", async () => {
      const student = await createAuthUser(db, { email: "student@campus.test" });
      await expect(requestMembership(db, student, w.orgA.slug)).resolves.toBeTypeOf("string");
    });

    it("checks the Auth email, not the profile copy", async () => {
      await db.query("update public.profiles set email = 'spoof@campus.test' where id = $1", [w.applicant]);
      expect((await pgError(requestMembership(db, w.applicant, w.orgA.slug))).code).toBe("CS403");
    });

    it("never grants anything beyond the right to apply", async () => {
      const student = await createAuthUser(db, { email: "student2@campus.test" });
      await requestMembership(db, student, w.orgA.slug);
      const perms = await asUser(db, student, (tx) =>
        scalar<string[]>(tx, "select private.my_org_permissions($1) as v", [w.orgA.id]),
      );
      expect(perms).toEqual([]);
    });
  });

  describe("organization-specific profile questions", () => {
    beforeEach(async () => {
      await db.query(
        `insert into public.organization_profile_fields (organization_id, field_key, label, field_type, is_required, options)
         values ($1, 'year', 'Year of study', 'select', true, '["1","2","3","4"]'),
                ($1, 'portfolio', 'Portfolio', 'url', false, null),
                ($1, 'age', 'Age', 'number', false, null)`,
        [w.orgA.id],
      );
    });

    it("requires required answers", async () => {
      const err = await pgError(requestMembership(db, w.applicant, w.orgA.slug, {}));
      expect(err).toMatchObject({ code: "CS422", message: expect.stringMatching(/"year" is required/) });
    });

    it("rejects unknown fields, wrong types and invalid options", async () => {
      for (const answers of [
        { year: "2", unexpected: "x" },
        { year: "9" },
        { year: "2", age: "twenty" },
        { year: "2", portfolio: "javascript:alert(1)" },
      ]) {
        expect((await pgError(requestMembership(db, w.applicant, w.orgA.slug, answers))).code).toBe("CS422");
      }
    });

    it("accepts valid answers and stores them on the request", async () => {
      const id = await requestMembership(db, w.applicant, w.orgA.slug, { year: "2", portfolio: "https://example.test/me" });
      const answers = await scalar<unknown>(db, "select answers as v from public.membership_requests where id = $1", [id]);
      expect(answers).toEqual({ year: "2", portfolio: "https://example.test/me" });
    });

    it("does not apply one organization's questions to another", async () => {
      await expect(requestMembership(db, w.applicant, w.orgB.slug, {})).resolves.toBeTypeOf("string");
    });
  });
});

describe("reviewing requests", () => {
  let requestId: string;
  beforeEach(async () => {
    requestId = await requestMembership(db, w.applicant, w.orgA.slug);
  });

  it("approval by an officer creates an active membership with the default role", async () => {
    const mId = await approve(db, w.officerA, requestId);

    const membership = await db.query<{ status: string; source_request_id: string }>(
      "select status, source_request_id from public.organization_memberships where id = $1",
      [mId],
    );
    expect(membership.rows[0]).toEqual({ status: "active", source_request_id: requestId });

    const roles = await db.query<{ role_key: string }>(
      `select r.role_key from public.membership_roles mr join public.organization_roles r on r.id = mr.role_id
        where mr.membership_id = $1`,
      [mId],
    );
    expect(roles.rows).toEqual([{ role_key: "member" }]);
    expect((await requestRow(requestId)).rows[0]).toMatchObject({ status: "approved", reviewed_by: w.officerA });
  });

  it("a second approval of the same request fails instead of creating a second membership", async () => {
    await approve(db, w.officerA, requestId);
    const err = await pgError(approve(db, w.ownerA, requestId));
    expect(err).toMatchObject({ code: "CS409", message: expect.stringMatching(/already been approved/) });
    const n = await scalar<number>(
      db,
      "select count(*)::int as v from public.organization_memberships where user_id = $1",
      [w.applicant],
    );
    expect(n).toBe(1);
  });

  it("an approved request cannot then be rejected", async () => {
    await approve(db, w.officerA, requestId);
    const err = await pgError(
      asUser(db, w.ownerA, (tx) => tx.query("select private.reject_membership_request($1, 'late')", [requestId])),
    );
    expect(err.code).toBe("CS409");
  });

  it("rejection records the reason, and the applicant may apply again later", async () => {
    await asUser(db, w.officerA, (tx) =>
      tx.query("select private.reject_membership_request($1, $2)", [requestId, "  Incomplete answers  "]),
    );
    expect((await requestRow(requestId)).rows[0]).toMatchObject({
      status: "rejected",
      rejection_reason: "Incomplete answers",
    });

    const again = await requestMembership(db, w.applicant, w.orgA.slug);
    expect(again).not.toBe(requestId);
  });

  it("plain members cannot review", async () => {
    expect((await pgError(approve(db, w.memberA, requestId))).code).toBe("CS404");
  });

  it("applicants cannot approve themselves", async () => {
    expect((await pgError(approve(db, w.applicant, requestId))).code).toBe("CS404");
  });

  it("officers of another organization cannot review, and learn nothing (not found, not forbidden)", async () => {
    const err = await pgError(approve(db, w.officerB, requestId));
    expect(err).toMatchObject({ code: "CS404", message: "membership request not found" });
  });

  it("an officer in A who is only a member in B cannot review B's requests", async () => {
    const inB = await requestMembership(db, w.applicant, w.orgB.slug);
    expect((await pgError(approve(db, w.crossUser, inB))).code).toBe("CS404");
    // ...but can review A's, where they are an officer.
    await expect(approve(db, w.crossUser, requestId)).resolves.toBeTypeOf("string");
  });

  it("platform admins get no organization authority from being platform admins", async () => {
    expect((await pgError(approve(db, w.platformAdmin, requestId))).code).toBe("CS404");
  });

  it("an unknown request id is not found", async () => {
    expect((await pgError(approve(db, w.officerA, "00000000-0000-0000-0000-000000000000"))).code).toBe("CS404");
  });
});

describe("withdrawing a request", () => {
  it("the applicant can withdraw their own pending request", async () => {
    const id = await requestMembership(db, w.applicant, w.orgA.slug);
    await asUser(db, w.applicant, (tx) => tx.query("select private.withdraw_membership_request($1)", [id]));
    expect((await requestRow(id)).rows[0]?.status).toBe("withdrawn");
  });

  it("nobody else can withdraw it, not even an officer", async () => {
    const id = await requestMembership(db, w.applicant, w.orgA.slug);
    const err = await pgError(
      asUser(db, w.officerA, (tx) => tx.query("select private.withdraw_membership_request($1)", [id])),
    );
    expect(err.code).toBe("CS404");
  });

  it("a reviewed request can no longer be withdrawn", async () => {
    const id = await requestMembership(db, w.applicant, w.orgA.slug);
    await approve(db, w.officerA, id);
    const err = await pgError(
      asUser(db, w.applicant, (tx) => tx.query("select private.withdraw_membership_request($1)", [id])),
    );
    expect(err.code).toBe("CS409");
  });
});

describe("platform administration", () => {
  it("only platform admins can create organizations", async () => {
    const err = await pgError(
      asUser(db, w.ownerA, (tx) => tx.query("select private.create_organization('gamma-guild', 'Gamma Guild', $1)", [w.ownerA])),
    );
    expect(err.code).toBe("CS403");
  });

  it("a new organization needs no code changes and starts with owner/officer/member roles", async () => {
    const orgId = await asUser(db, w.platformAdmin, (tx) =>
      scalar<string>(tx, "select private.create_organization('gamma-guild', 'Gamma Guild', $1) as v", [w.applicant]),
    );
    const roles = await db.query<{ role_key: string; is_default: boolean }>(
      "select role_key, is_default from public.organization_roles where organization_id = $1 order by role_key",
      [orgId],
    );
    expect(roles.rows).toEqual([
      { role_key: "member", is_default: true },
      { role_key: "officer", is_default: false },
      { role_key: "owner", is_default: false },
    ]);
    const perms = await asUser(db, w.applicant, (tx) =>
      scalar<string[]>(tx, "select private.my_org_permissions($1) as v", [orgId]),
    );
    expect(perms).toContain("role.manage");
  });

  it("suspending an organization removes every member's permissions there", async () => {
    await asUser(db, w.platformAdmin, (tx) =>
      tx.query("select private.set_organization_status($1, 'suspended')", [w.orgA.id]),
    );
    const perms = await asUser(db, w.ownerA, (tx) =>
      scalar<string[]>(tx, "select private.my_org_permissions($1) as v", [w.orgA.id]),
    );
    expect(perms).toEqual([]);
  });
});
