import "server-only";
import { reserveRequest } from "@/server/rate-limit";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { VerifiedActor } from "@/server/auth/actor";
import { assertPermission, loadOrgAccess } from "@/server/authz/org-access";
import type { Permission } from "@/server/authz/permissions";
import * as schema from "@/server/db/schema";
import type { Database, DbTransaction } from "@/server/db/types";
import { queryRows, withUserContext } from "@/server/db/user-context";
import { AppError, handleServiceError } from "@/server/errors";
import { chunkDocument } from "@/server/search/chunking";
import { getEmbedder } from "@/server/search/embeddings";
import { OrganizationSlug } from "@/server/validation/inputs";
import { type FeatureKey } from "@/server/validation/organization-config";
import { extractToken } from "@/server/services/events";

async function inModule<T>(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  feature: FeatureKey,
  permission: Permission | null,
  fn: (tx: DbTransaction, org: string) => Promise<T>,
): Promise<T> {
  try {
    return await withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, OrganizationSlug.parse(slug));
      if (permission) assertPermission(access, permission);
      const [enabled] = await queryRows(
        tx,
        sql`select private.module_enabled(${access.organization.id}::uuid,${feature}) as enabled`,
        z.object({ enabled: z.boolean() }),
      );
      if (!enabled?.enabled)
        throw new AppError("NOT_FOUND", "Module not available in this club.");
      return fn(tx, access.organization.id);
    });
  } catch (error) {
    throw handleServiceError(`module.${feature}`, error);
  }
}

const Id = z.uuid();
const ShortText = z.string().trim().min(2).max(120);
const Int = z.coerce.number().int();
const Value = z.object({ v: z.unknown() });

export async function getInventory(
  db: Database,
  actor: VerifiedActor,
  slug: string,
) {
  return inModule(db, actor, slug, "inventory", null, async (tx, org) => {
    const items = await tx
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.organizationId, org));
    const slots = await tx
      .select()
      .from(schema.mealSlots)
      .where(eq(schema.mealSlots.organizationId, org));
    const movements = await tx
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.organizationId, org))
      .orderBy(desc(schema.stockMovements.createdAt))
      .limit(100);
    return { items, slots, movements };
  });
}
export async function adjustInventory(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  input: { itemId?: string; name: string; delta: string; reason: string },
) {
  const item = input.itemId ? Id.parse(input.itemId) : null;
  const name = item ? input.name : ShortText.parse(input.name);
  const delta = Int.min(-100000)
    .max(100000)
    .refine((v) => v !== 0)
    .parse(input.delta);
  const reason = z.string().trim().min(1).max(300).parse(input.reason);
  return inModule(db, actor, slug, "inventory", "inventory.manage", (tx, org) =>
    tx.execute(
      sql`select private.adjust_inventory(${org}::uuid,${item}::uuid,${name},${delta},${reason})`,
    ),
  );
}
export async function createMealSlot(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  input: { eventId: string; itemId: string; name: string },
) {
  const event = Id.parse(input.eventId),
    item = Id.parse(input.itemId),
    name = ShortText.max(100).parse(input.name);
  return inModule(db, actor, slug, "inventory", "inventory.manage", (tx, org) =>
    tx.execute(
      sql`select private.create_meal_slot(${org}::uuid,${event}::uuid,${item}::uuid,${name})`,
    ),
  );
}
export async function claimMeal(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  input: { eventId: string; slotId: string; scanned: string },
) {
  await reserveRequest(db, actor, "scan");
  const event = Id.parse(input.eventId),
    slot = Id.parse(input.slotId),
    token = extractToken(z.string().max(500).parse(input.scanned));
  return inModule(
    db,
    actor,
    slug,
    "inventory",
    "food.distribute",
    async (tx, org) => {
      const [target] = await tx
        .select({ id: schema.mealSlots.id })
        .from(schema.mealSlots)
        .where(
          and(
            eq(schema.mealSlots.id, slot),
            eq(schema.mealSlots.eventId, event),
            eq(schema.mealSlots.organizationId, org),
          ),
        );
      if (!target) throw new AppError("NOT_FOUND", "Meal slot not found.");
      const [row] = await queryRows(
        tx,
        sql`select private.claim_meal(${event}::uuid,${slot}::uuid,${token}) as v`,
        z.object({
          v: z.object({
            status: z.enum(["claimed", "already_claimed"]),
            display_name: z.string(),
          }),
        }),
      );
      if (!row) throw new Error("claim returned no row");
      return row.v;
    },
  );
}
export async function getTasks(
  db: Database,
  actor: VerifiedActor,
  slug: string,
) {
  return inModule(db, actor, slug, "volunteers", null, async (tx, org) => ({
    tasks: await tx
      .select()
      .from(schema.volunteerTasks)
      .where(eq(schema.volunteerTasks.organizationId, org)),
    assignments: await tx
      .select()
      .from(schema.taskAssignments)
      .where(eq(schema.taskAssignments.organizationId, org)),
    members: await tx
      .select({
        id: schema.organizationMemberships.id,
        name: schema.profiles.displayName,
        userId: schema.profiles.id,
      })
      .from(schema.organizationMemberships)
      .innerJoin(
        schema.profiles,
        eq(schema.profiles.id, schema.organizationMemberships.userId),
      )
      .where(
        and(
          eq(schema.organizationMemberships.organizationId, org),
          eq(schema.organizationMemberships.status, "active"),
        ),
      ),
  }));
}
export async function createTask(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  input: {
    title: string;
    description: string;
    eventId?: string;
    dueAt?: string;
  },
) {
  const title = ShortText.min(3).parse(input.title),
    description = z.string().max(5000).parse(input.description);
  const event = input.eventId ? Id.parse(input.eventId) : null;
  const due = input.dueAt
    ? z.coerce.date().parse(input.dueAt).toISOString()
    : null;
  return inModule(db, actor, slug, "volunteers", "task.manage", (tx, org) =>
    tx.execute(
      sql`select private.create_task(${org}::uuid,${event}::uuid,${title},${description},${due}::timestamptz)`,
    ),
  );
}
export async function assignTask(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  taskId: string,
  membershipId: string,
) {
  const task = Id.parse(taskId),
    membership = Id.parse(membershipId);
  return inModule(db, actor, slug, "volunteers", "task.manage", (tx, org) =>
    tx.execute(
      sql`select private.assign_task(${org}::uuid,${task}::uuid,${membership}::uuid)`,
    ),
  );
}
export async function completeTask(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  taskId: string,
) {
  const task = Id.parse(taskId);
  return inModule(db, actor, slug, "volunteers", null, (tx, org) =>
    tx.execute(sql`select private.complete_task(${org}::uuid,${task}::uuid)`),
  );
}
export async function getCtf(db: Database, actor: VerifiedActor, slug: string) {
  return inModule(db, actor, slug, "ctf", null, async (tx, org) => ({
    challenges: await tx
      .select({
        id: schema.ctfChallenges.id,
        eventId: schema.ctfChallenges.eventId,
        title: schema.ctfChallenges.title,
        description: schema.ctfChallenges.description,
        points: schema.ctfChallenges.points,
      })
      .from(schema.ctfChallenges)
      .where(eq(schema.ctfChallenges.organizationId, org)),
    solves: await tx
      .select()
      .from(schema.ctfSolves)
      .where(eq(schema.ctfSolves.organizationId, org)),
    scoreboard: await tx
      .select()
      .from(schema.ctfScoreboard)
      .where(eq(schema.ctfScoreboard.organizationId, org))
      .orderBy(schema.ctfScoreboard.rank),
  }));
}
export async function createChallenge(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  input: {
    eventId: string;
    title: string;
    description: string;
    points: string;
    flag: string;
  },
) {
  const event = Id.parse(input.eventId),
    title = ShortText.min(3).parse(input.title),
    description = z.string().min(1).max(5000).parse(input.description);
  const points = Int.min(1).max(10000).parse(input.points),
    flag = z.string().min(1).max(500).parse(input.flag);
  return inModule(db, actor, slug, "ctf", "ctf.manage", (tx, org) =>
    tx.execute(
      sql`select private.create_challenge(${org}::uuid,${event}::uuid,${title},${description},${points},${flag})`,
    ),
  );
}
export async function submitFlag(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  challengeId: string,
  flag: string,
) {
  await reserveRequest(db, actor, "flag");
  const challenge = Id.parse(challengeId),
    value = z.string().min(1).max(500).parse(flag);
  return inModule(db, actor, slug, "ctf", null, async (tx, org) => {
    const [row] = await queryRows(
      tx,
      sql`select private.submit_flag(${org}::uuid,${challenge}::uuid,${value}) as v`,
      Value,
    );
    return z.enum(["solved", "already_solved", "incorrect"]).parse(row?.v);
  });
}
export async function getCertificates(
  db: Database,
  actor: VerifiedActor,
  slug: string,
) {
  return inModule(db, actor, slug, "certificates", null, (tx, org) =>
    tx
      .select()
      .from(schema.certificates)
      .where(eq(schema.certificates.organizationId, org))
      .orderBy(desc(schema.certificates.issuedAt)),
  );
}
export async function issueCertificates(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  eventId: string,
) {
  const event = Id.parse(eventId);
  return inModule(
    db,
    actor,
    slug,
    "certificates",
    "certificate.issue",
    (tx, org) =>
      tx.execute(
        sql`select private.issue_certificates(${org}::uuid,${event}::uuid)`,
      ),
  );
}
export async function submitMemberDocument(
  db: Database,
  actor: VerifiedActor,
  slug: string,
  input: {
    kind: "feedback" | "writeup";
    targetId: string;
    body: string;
    rating?: string;
  },
) {
  const target = Id.parse(input.targetId),
    body = z.string().trim().min(1).max(5000).parse(input.body);
  const rating =
    input.kind === "feedback" ? Int.min(1).max(5).parse(input.rating) : null;
  const chunks = chunkDocument(
    input.kind === "feedback" ? "Event feedback" : "CTF write-up",
    body,
  );
  const embedder = await getEmbedder();
  const vectors = await embedder.embed(chunks);
  const payload = JSON.stringify(
    chunks.map((content, i) => ({ content, embedding: vectors[i] })),
  );
  return inModule(
    db,
    actor,
    slug,
    input.kind === "feedback" ? "feedback" : "ctf",
    null,
    (tx, org) =>
      tx.execute(
        input.kind === "feedback"
          ? sql`select private.submit_feedback(${org}::uuid,${target}::uuid,${rating},${body},${embedder.model},${payload}::jsonb)`
          : sql`select private.save_writeup(${org}::uuid,${target}::uuid,${body},${embedder.model},${payload}::jsonb)`,
      ),
  );
}
export async function getFeedback(
  db: Database,
  actor: VerifiedActor,
  slug: string,
) {
  return inModule(db, actor, slug, "feedback", null, (tx, org) =>
    tx
      .select()
      .from(schema.eventFeedback)
      .where(eq(schema.eventFeedback.organizationId, org)),
  );
}
export async function getContributions(
  db: Database,
  actor: VerifiedActor,
  slug: string,
) {
  return inModule(db, actor, slug, "analytics", "analytics.read", (tx, org) =>
    tx
      .select()
      .from(schema.reportMemberContributions)
      .where(eq(schema.reportMemberContributions.organizationId, org))
      .orderBy(schema.reportMemberContributions.rank),
  );
}
