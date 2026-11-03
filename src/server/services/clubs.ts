import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { VerifiedActor } from "@/server/auth/actor";
import { loadOrgAccess, type OrgAccess } from "@/server/authz/org-access";
import {
  membershipRequests,
  organizationEmailDomains,
  organizationMemberships,
  organizationProfileFields,
  organizations,
  profiles,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { withUserContext } from "@/server/db/user-context";
import { AppError, handleServiceError } from "@/server/errors";
import { OrganizationSlug } from "@/server/validation/inputs";

async function run<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw handleServiceError(operation, error);
  }
}

export interface ClubCard {
  slug: string;
  name: string;
  status: string;
  onboardingPolicy: string;
  primaryColor: string | null;
  membership: "active" | "suspended" | null;
  pendingRequest: boolean;
}

/** Every club the caller can see (RLS: active clubs, plus clubs they belong to). */
export async function listClubs(db: Database, actor: VerifiedActor): Promise<ClubCard[]> {
  return run("clubs.list", () =>
    withUserContext(db, actor, async (tx) => {
      const orgs = await tx
        .select({
          id: organizations.id,
          slug: organizations.slug,
          name: organizations.name,
          status: organizations.status,
          onboardingPolicy: organizations.onboardingPolicy,
          branding: organizations.branding,
          membership: organizationMemberships.status,
        })
        .from(organizations)
        .leftJoin(
          organizationMemberships,
          and(eq(organizationMemberships.organizationId, organizations.id), eq(organizationMemberships.userId, actor.userId)),
        )
        .orderBy(asc(organizations.name));

      const pending = await tx
        .select({ organizationId: membershipRequests.organizationId })
        .from(membershipRequests)
        .where(and(eq(membershipRequests.userId, actor.userId), eq(membershipRequests.status, "pending")));
      const pendingSet = new Set(pending.map((p) => p.organizationId));

      return orgs.map((o) => ({
        slug: o.slug,
        name: o.name,
        status: o.status,
        onboardingPolicy: o.onboardingPolicy,
        primaryColor: typeof o.branding.primaryColor === "string" ? o.branding.primaryColor : null,
        membership: o.membership ?? null,
        pendingRequest: pendingSet.has(o.id),
      }));
    }),
  );
}

export interface JoinForm {
  organization: { slug: string; name: string; onboardingPolicy: string };
  fields: Array<{ key: string; label: string; type: string; required: boolean; options: string[] | null }>;
  emailDomains: string[];
}

export async function getJoinForm(db: Database, actor: VerifiedActor, organizationSlug: string): Promise<JoinForm> {
  return run("clubs.join_form", async () => {
    const slug = OrganizationSlug.parse(organizationSlug);
    return withUserContext(db, actor, async (tx) => {
      const [org] = await tx
        .select({ id: organizations.id, slug: organizations.slug, name: organizations.name, onboardingPolicy: organizations.onboardingPolicy })
        .from(organizations)
        .where(and(eq(organizations.slug, slug), eq(organizations.status, "active")));
      if (!org) throw new AppError("NOT_FOUND", "Organization not found.");

      const fields = await tx
        .select()
        .from(organizationProfileFields)
        .where(eq(organizationProfileFields.organizationId, org.id))
        .orderBy(asc(organizationProfileFields.position));
      const domains = await tx
        .select({ domain: organizationEmailDomains.domain })
        .from(organizationEmailDomains)
        .where(eq(organizationEmailDomains.organizationId, org.id));

      return {
        organization: { slug: org.slug, name: org.name, onboardingPolicy: org.onboardingPolicy },
        fields: fields.map((f) => ({ key: f.fieldKey, label: f.label, type: f.fieldType, required: f.isRequired, options: f.options })),
        emailDomains: domains.map((d) => d.domain),
      };
    });
  });
}

/** Club context for every page under /o/[slug]: name, branding and the caller's permissions. */
export async function getClubContext(
  db: Database,
  actor: VerifiedActor,
  organizationSlug: string,
): Promise<OrgAccess & { isMember: boolean; primaryColor: string | null; me: { displayName: string } }> {
  return run("clubs.context", async () => {
    const slug = OrganizationSlug.parse(organizationSlug);
    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      const [membership] = await tx
        .select({ status: organizationMemberships.status })
        .from(organizationMemberships)
        .where(and(eq(organizationMemberships.organizationId, access.organization.id), eq(organizationMemberships.userId, actor.userId)));
      const [org] = await tx.select({ branding: organizations.branding }).from(organizations).where(eq(organizations.id, access.organization.id));
      const [me] = await tx.select({ displayName: profiles.displayName }).from(profiles).where(eq(profiles.id, actor.userId));
      const color = org?.branding.primaryColor;
      return {
        ...access,
        isMember: membership?.status === "active",
        primaryColor: typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null,
        me: { displayName: me?.displayName ?? "Member" },
      };
    });
  });
}

export async function getMyProfile(db: Database, actor: VerifiedActor) {
  return run("profile.get", () =>
    withUserContext(db, actor, async (tx) => {
      const [me] = await tx.select({ displayName: profiles.displayName, email: profiles.email }).from(profiles).where(eq(profiles.id, actor.userId));
      return me ?? { displayName: "Member", email: actor.email };
    }),
  );
}
