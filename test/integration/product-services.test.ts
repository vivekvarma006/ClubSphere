import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifiedActor } from "@/server/auth/actor";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import {
  adjustInventory,
  createMealSlot,
  getInventory,
  claimMeal,
  createTask,
  getTasks,
  assignTask,
  completeTask,
  createChallenge,
  getCtf,
  submitFlag,
  getCertificates,
  issueCertificates,
  submitMemberDocument,
  getFeedback,
  getContributions,
} from "@/server/services/operations";
import { checkInByToken } from "@/server/services/events";
import { verifyCertificate } from "@/server/services/certificates";
import { getContributionReport } from "@/server/services/contribution-report";
import { freshWorld, membershipId, type World } from "../db/fixtures";
import { asUser, scalar } from "../db/harness";
let pg: PGlite, db: Database, w: World, event: string, token: string;
const actor = (id: string) => verifiedActor(id, null);
beforeEach(async () => {
  vi.stubEnv("EMBEDDINGS_PROVIDER", "hash");
  vi.stubEnv("AUTH_MODE", "demo");
  ({ db: pg, w } = await freshWorld());
  db = drizzle(pg, { schema });
  await pg.exec(
    `update public.organizations set settings='{"features":{"inventory":true,"volunteers":true,"ctf":true,"certificates":true,"feedback":true,"analytics":true}}'`,
  );
  event = await scalar<string>(
    pg,
    "insert into public.events(organization_id,title,category,starts_at,ends_at,status) values($1,'Services workshop','ctf',now()-interval '1 hour',now()+interval '1 hour','published') returning id as v",
    [w.orgA.id],
  );
  const registration = await asUser(pg, w.memberA, (tx) =>
    scalar<string>(tx, "select private.register_for_event($1) as v", [event]),
  );
  token = await scalar<string>(
    pg,
    "select token as v from public.registration_credentials where registration_id=$1",
    [registration],
  );
});
afterEach(async () => {
  await pg?.close();
  vi.unstubAllEnvs();
});
it("runs stock, scanner, tasks, CTF, feedback, certificates and contributions through typed services", async () => {
  const manager = actor(w.officerA),
    member = actor(w.memberA),
    slug = w.orgA.slug;
  await adjustInventory(db, manager, slug, {
    name: "Meal boxes",
    delta: "3",
    reason: "Delivery",
  });
  const item = (await getInventory(db, manager, slug)).items[0]!;
  await createMealSlot(db, manager, slug, {
    eventId: event,
    itemId: item.id,
    name: "Dinner",
  });
  const slot = (await getInventory(db, manager, slug)).slots[0]!;
  await checkInByToken(db, manager, {
    organizationSlug: slug,
    eventId: event,
    scanned: token,
  });
  expect(
    await claimMeal(db, manager, slug, {
      eventId: event,
      slotId: slot.id,
      scanned: token,
    }),
  ).toMatchObject({ status: "claimed" });
  expect((await getInventory(db, manager, slug)).items[0]?.quantity).toBe(2);
  await createTask(db, manager, slug, {
    title: "Arrange venue",
    description: "Move chairs",
    eventId: event,
  });
  const task = (await getTasks(db, manager, slug)).tasks[0]!;
  await assignTask(
    db,
    manager,
    slug,
    task.id,
    await membershipId(pg, w.orgA.id, w.memberA),
  );
  await completeTask(db, member, slug, task.id);
  expect(
    (await getTasks(db, member, slug)).assignments[0]?.completedAt,
  ).toBeInstanceOf(Date);
  await createChallenge(db, manager, slug, {
    eventId: event,
    title: "Test challenge",
    description: "Find the flag",
    points: "50",
    flag: "flag{service}",
  });
  const challenge = (await getCtf(db, member, slug)).challenges[0]!;
  expect(
    await submitFlag(db, member, slug, challenge.id, "flag{service}"),
  ).toBe("solved");
  await pg.query("update public.events set status='completed' where id=$1", [
    event,
  ]);
  await submitMemberDocument(db, member, slug, {
    kind: "feedback",
    targetId: event,
    body: "Useful workshop about cryptography",
    rating: "4",
  });
  expect((await getFeedback(db, member, slug))[0]?.rating).toBe(4);
  await submitMemberDocument(db, member, slug, {
    kind: "writeup",
    targetId: challenge.id,
    body: "I decoded the ciphertext.",
  });
  await issueCertificates(db, manager, slug, event);
  const cert = (await getCertificates(db, member, slug))[0]!;
  expect(await verifyCertificate(db, cert.verificationCode)).toMatchObject({
    recipient_name: "member-a",
    event_title: "Services workshop",
  });
  expect(
    (await getContributions(db, manager, slug)).find(
      (r) => r.userId === w.memberA,
    ),
  ).toMatchObject({ score: 85, rank: 1 });
  const report = await getContributionReport(db, manager, slug);
  expect(report.summary).toMatchObject({ contributors: 1, attendance: 1, tasks: 1, ctfPoints: 50, certificates: 1 });
  expect(report.members.find((r) => r.userId === w.memberA)).toMatchObject({ score: 85, rank: 1 });
});
it("counts failed scans in the durable service request budget", async () => {
  for (let i = 0; i < 120; i++)
    await expect(
      checkInByToken(db, actor(w.officerA), {
        organizationSlug: w.orgA.slug,
        eventId: event,
        scanned: "bad",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(
    checkInByToken(db, actor(w.officerA), {
      organizationSlug: w.orgA.slug,
      eventId: event,
      scanned: token,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("refuses cross-club IDs at the service boundary", async () => {
  await expect(
    getInventory(db, actor(w.officerB), w.orgA.slug),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    createTask(db, actor(w.memberA), w.orgA.slug, {
      title: "No permission",
      description: "",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
