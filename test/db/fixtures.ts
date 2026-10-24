import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb, scalar } from "./harness";

// Fixture data is fictional and deliberately generic: ClubSphere's code and
// tests must not assume any particular club or university.

export interface UserOptions {
  email: string;
  verified?: boolean;
  anonymous?: boolean;
  name?: string;
}

/** Inserts an Auth user directly (as Supabase Auth would). The profile is created by trigger. */
export async function createAuthUser(db: PGlite, opts: UserOptions): Promise<string> {
  return scalar<string>(
    db,
    `insert into auth.users (email, email_confirmed_at, is_anonymous, raw_user_meta_data)
     values ($1, case when $2 then now() end, $3, jsonb_build_object('full_name', $4::text))
     returning id as v`,
    [opts.email, opts.verified ?? true, opts.anonymous ?? false, opts.name ?? null],
  );
}

export async function makePlatformAdmin(db: PGlite, userId: string): Promise<void> {
  await db.query("insert into public.platform_admins (user_id, note) values ($1, 'test fixture')", [userId]);
}

export async function roleId(db: PGlite, orgId: string, roleKey: string): Promise<string> {
  return scalar<string>(
    db,
    "select id as v from public.organization_roles where organization_id = $1 and role_key = $2",
    [orgId, roleKey],
  );
}

export async function membershipId(db: PGlite, orgId: string, userId: string): Promise<string> {
  return scalar<string>(
    db,
    "select id as v from public.organization_memberships where organization_id = $1 and user_id = $2",
    [orgId, userId],
  );
}

export async function requestMembership(
  db: PGlite,
  userId: string,
  orgSlug: string,
  answers: Record<string, unknown> = {},
): Promise<string> {
  return asUser(db, userId, (tx) =>
    scalar<string>(tx, "select private.request_membership($1, $2::jsonb) as v", [orgSlug, JSON.stringify(answers)]),
  );
}

export async function approve(db: PGlite, reviewerId: string, requestId: string): Promise<string> {
  return asUser(db, reviewerId, (tx) =>
    scalar<string>(tx, "select private.approve_membership_request($1) as v", [requestId]),
  );
}

export interface Org {
  id: string;
  slug: string;
}

/** Full onboarding path: request -> approve -> optional extra role (assigned by `approverId`). */
export async function joinOrg(
  db: PGlite,
  org: Org,
  userId: string,
  approverId: string,
  extraRole?: string,
): Promise<string> {
  const requestId = await requestMembership(db, userId, org.slug);
  const mId = await approve(db, approverId, requestId);
  if (extraRole) {
    const rId = await roleId(db, org.id, extraRole);
    await asUser(db, approverId, (tx) => tx.query("select private.assign_role($1, $2)", [mId, rId]));
  }
  return mId;
}

/**
 * Two organizations with users in different roles:
 *
 *   alpha-society   owner: ownerA   officers: officerA, crossUser   member: memberA
 *   beta-circle     owner: ownerB   officer:  officerB              members: memberB, crossUser
 *
 *   crossUser is an OFFICER in alpha but only a MEMBER in beta.
 *   applicant is verified and belongs nowhere; unverified has not confirmed email.
 */
export interface World {
  platformAdmin: string;
  orgA: Org;
  orgB: Org;
  ownerA: string;
  officerA: string;
  memberA: string;
  ownerB: string;
  officerB: string;
  memberB: string;
  crossUser: string;
  applicant: string;
  unverified: string;
}

export async function buildWorld(db: PGlite): Promise<World> {
  const user = (name: string, verified = true) =>
    createAuthUser(db, { email: `${name}@example.test`, verified, name });

  const platformAdmin = await user("platform-admin");
  await makePlatformAdmin(db, platformAdmin);

  const ownerA = await user("owner-a");
  const officerA = await user("officer-a");
  const memberA = await user("member-a");
  const ownerB = await user("owner-b");
  const officerB = await user("officer-b");
  const memberB = await user("member-b");
  const crossUser = await user("cross-user");
  const applicant = await user("applicant");
  const unverified = await user("unverified", false);

  const createOrg = (slug: string, name: string, owner: string) =>
    asUser(db, platformAdmin, (tx) =>
      scalar<string>(tx, "select private.create_organization($1, $2, $3) as v", [slug, name, owner]),
    );

  const orgA = { id: await createOrg("alpha-society", "Alpha Society", ownerA), slug: "alpha-society" };
  const orgB = { id: await createOrg("beta-circle", "Beta Circle", ownerB), slug: "beta-circle" };

  await joinOrg(db, orgA, officerA, ownerA, "officer");
  await joinOrg(db, orgA, crossUser, ownerA, "officer");
  await joinOrg(db, orgA, memberA, ownerA);

  await joinOrg(db, orgB, officerB, ownerB, "officer");
  await joinOrg(db, orgB, memberB, ownerB);
  await joinOrg(db, orgB, crossUser, ownerB);

  return {
    platformAdmin,
    orgA,
    orgB,
    ownerA,
    officerA,
    memberA,
    ownerB,
    officerB,
    memberB,
    crossUser,
    applicant,
    unverified,
  };
}

let worldTemplate: Promise<{ db: PGlite; world: World }> | undefined;

/** A clean copy of the standard world. Built once per test file, then cloned. */
export async function freshWorld(): Promise<{ db: PGlite; w: World }> {
  worldTemplate ??= (async () => {
    const db = await freshDb();
    return { db, world: await buildWorld(db) };
  })();
  const { db, world } = await worldTemplate;
  return { db: (await db.clone()) as PGlite, w: world }; // see freshDb() on the cast
}
