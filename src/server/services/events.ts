import "server-only";
import { reserveRequest } from "@/server/rate-limit";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { VerifiedActor } from "@/server/auth/actor";
import { assertPermission, loadOrgAccess } from "@/server/authz/org-access";
import {
  eventAttendance,
  eventRegistrations,
  events,
  organizations,
  profiles,
  registrationCredentials,
  type EventCategory,
  type EventStatus,
} from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { queryRows, withUserContext } from "@/server/db/user-context";
import { AppError, handleServiceError } from "@/server/errors";
import { OrganizationSlug } from "@/server/validation/inputs";

/**
 * Events, registrations and QR check-in. Reads go through RLS; writes that
 * need cross-row rules (capacity, exactly-once check-in) go through the
 * procedures in 20261103001100_events_and_attendance.sql.
 */

async function run<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw handleServiceError(operation, error);
  }
}

const EventId = z.uuid();

export const EVENT_CATEGORIES = ["workshop", "hackathon", "ctf", "talk", "competition", "social", "recruitment", "other"] as const;

export interface EventSummary {
  id: string;
  title: string;
  category: EventCategory;
  venue: string | null;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  status: EventStatus;
  registered: number;
  myRegistration: "registered" | "cancelled" | null;
}

export async function listEvents(
  db: Database,
  actor: VerifiedActor,
  organizationSlug: string,
  when: "upcoming" | "past" | "all",
): Promise<EventSummary[]> {
  return run("events.list", async () => {
    const slug = OrganizationSlug.parse(organizationSlug);
    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      const now = new Date();
      const rows = await tx
        .select({
          id: events.id,
          title: events.title,
          category: events.category,
          venue: events.venue,
          startsAt: events.startsAt,
          endsAt: events.endsAt,
          capacity: events.capacity,
          status: events.status,
          myRegistration: eventRegistrations.status,
        })
        .from(events)
        .leftJoin(
          eventRegistrations,
          and(eq(eventRegistrations.eventId, events.id), eq(eventRegistrations.userId, actor.userId)),
        )
        .where(
          and(
            eq(events.organizationId, access.organization.id),
            when === "all" ? undefined : when === "upcoming" ? gte(events.endsAt, now) : lt(events.endsAt, now),
          ),
        )
        .orderBy(when === "upcoming" ? asc(events.startsAt) : desc(events.startsAt))
        .limit(50);

      const counts = await queryRows(
        tx,
        sql`select event_id, registered from private.event_registration_counts(${access.organization.id}::uuid)`,
        z.object({ event_id: z.uuid(), registered: z.number() }),
      );
      const byEvent = new Map(counts.map((c) => [c.event_id, c.registered]));
      return rows.map((r) => ({ ...r, registered: byEvent.get(r.id) ?? 0, myRegistration: r.myRegistration ?? null }));
    });
  });
}

export interface Registrant {
  registrationId: string;
  displayName: string;
  status: "registered" | "cancelled";
  registeredAt: Date;
  checkedInAt: Date | null;
}

export interface EventDetail {
  event: typeof events.$inferSelect;
  ended: boolean;
  registered: number;
  canManage: boolean;
  canCheckIn: boolean;
  mine: { registrationId: string; status: "registered" | "cancelled"; token: string | null; checkedInAt: Date | null } | null;
  registrants: Registrant[] | null; // only for managers / scanners
}

export async function getEvent(
  db: Database,
  actor: VerifiedActor,
  organizationSlug: string,
  eventId: string,
): Promise<EventDetail> {
  return run("events.get", async () => {
    const slug = OrganizationSlug.parse(organizationSlug);
    const id = EventId.parse(eventId);
    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      const [event] = await tx
        .select()
        .from(events)
        .where(and(eq(events.id, id), eq(events.organizationId, access.organization.id)));
      if (!event) throw new AppError("NOT_FOUND", "Event not found.");

      const canManage = access.permissions.has("event.manage");
      const canCheckIn = access.permissions.has("event.checkin");

      const [mine] = await tx
        .select({
          registrationId: eventRegistrations.id,
          status: eventRegistrations.status,
          token: registrationCredentials.token,
          checkedInAt: eventAttendance.checkedInAt,
        })
        .from(eventRegistrations)
        .leftJoin(registrationCredentials, eq(registrationCredentials.registrationId, eventRegistrations.id))
        .leftJoin(eventAttendance, eq(eventAttendance.registrationId, eventRegistrations.id))
        .where(and(eq(eventRegistrations.eventId, id), eq(eventRegistrations.userId, actor.userId)));

      const [count] = await queryRows(
        tx,
        sql`select registered from private.event_registration_counts(${access.organization.id}::uuid) where event_id = ${id}::uuid`,
        z.object({ registered: z.number() }),
      );

      const registrants =
        canManage || canCheckIn
          ? await tx
              .select({
                registrationId: eventRegistrations.id,
                displayName: profiles.displayName,
                status: eventRegistrations.status,
                registeredAt: eventRegistrations.registeredAt,
                checkedInAt: eventAttendance.checkedInAt,
              })
              .from(eventRegistrations)
              .innerJoin(profiles, eq(profiles.id, eventRegistrations.userId))
              .leftJoin(eventAttendance, eq(eventAttendance.registrationId, eventRegistrations.id))
              .where(eq(eventRegistrations.eventId, id))
              .orderBy(asc(profiles.displayName))
          : null;

      return {
        event,
        ended: event.endsAt.getTime() < Date.now(),
        registered: count?.registered ?? 0,
        canManage,
        canCheckIn,
        mine: mine ? { ...mine, token: mine.status === "registered" ? mine.token : null } : null,
        registrants,
      };
    });
  });
}

const CreateEventInput = z
  .object({
    organizationSlug: OrganizationSlug,
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(5000).default(""),
    category: z.enum(EVENT_CATEGORIES),
    venue: z.string().trim().max(200).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    capacity: z.coerce.number().int().min(1).max(100000).optional(),
    publish: z.boolean().default(false),
  })
  .refine((e) => e.endsAt > e.startsAt, { path: ["endsAt"], message: "must be after the start time" });

export async function createEvent(
  db: Database,
  actor: VerifiedActor,
  input: z.input<typeof CreateEventInput>,
): Promise<{ eventId: string }> {
  return run("events.create", async () => {
    const e = CreateEventInput.parse(input);
    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, e.organizationSlug);
      assertPermission(access, "event.manage");
      // Explicit column list: API users may only write the granted columns
      // (created_by comes from the session via its column default).
      const [row] = await queryRows(
        tx,
        sql`insert into public.events (organization_id, title, description, category, venue, starts_at, ends_at, capacity, status)
            values (${access.organization.id}::uuid, ${e.title}, ${e.description}, ${e.category}, ${e.venue || null},
                    ${e.startsAt.toISOString()}::timestamptz, ${e.endsAt.toISOString()}::timestamptz,
                    ${e.capacity ?? null}::int, ${e.publish ? "published" : "draft"})
            returning id`,
        z.object({ id: z.uuid() }),
      );
      if (!row) throw new Error("insert returned no row");
      return { eventId: row.id };
    });
  });
}

const StatusChange = z.object({
  organizationSlug: OrganizationSlug,
  eventId: EventId,
  status: z.enum(["published", "completed", "cancelled"]),
});

export async function setEventStatus(db: Database, actor: VerifiedActor, input: z.input<typeof StatusChange>): Promise<void> {
  return run("events.set_status", async () => {
    const { organizationSlug, eventId, status } = StatusChange.parse(input);
    await withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, organizationSlug);
      assertPermission(access, "event.manage");
      const updated = await tx
        .update(events)
        .set({ status })
        .where(and(eq(events.id, eventId), eq(events.organizationId, access.organization.id)))
        .returning({ id: events.id });
      if (updated.length === 0) throw new AppError("NOT_FOUND", "Event not found.");
    });
  });
}

const EventRef = z.object({ organizationSlug: OrganizationSlug, eventId: EventId });

export async function registerForEvent(
  db: Database,
  actor: VerifiedActor,
  input: z.input<typeof EventRef>,
): Promise<{ registrationId: string }> {
  return run("events.register", async () => {
    const { organizationSlug, eventId } = EventRef.parse(input);
    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, organizationSlug);
      const [owned] = await queryRows(
        tx,
        sql`select organization_id from public.events where id = ${eventId}::uuid`,
        z.object({ organization_id: z.uuid() }),
      );
      if (!owned || owned.organization_id !== access.organization.id) throw new AppError("NOT_FOUND", "Event not found.");
      const [row] = await queryRows(tx, sql`select private.register_for_event(${eventId}::uuid) as v`, z.object({ v: z.uuid() }));
      if (!row) throw new Error("register_for_event returned no row");
      return { registrationId: row.v };
    });
  });
}

export async function cancelRegistration(db: Database, actor: VerifiedActor, registrationId: string): Promise<void> {
  return run("events.cancel_registration", async () => {
    const id = z.uuid().parse(registrationId);
    await withUserContext(db, actor, (tx) => tx.execute(sql`select private.cancel_registration(${id}::uuid)`));
  });
}

export interface CheckInResult {
  status: "checked_in" | "already_checked_in";
  displayName: string;
  checkedInAt: string;
}

const CheckInRow = z.object({
  v: z.object({
    status: z.enum(["checked_in", "already_checked_in"]),
    display_name: z.string(),
    checked_in_at: z.string(),
  }),
});

/** Accepts the raw token or anything containing it (some scanner apps add text). */
export function extractToken(scanned: string): string {
  const match = scanned.toLowerCase().match(/[0-9a-f]{64}/);
  return match ? match[0] : scanned.trim();
}

export async function checkInByToken(
  db: Database,
  actor: VerifiedActor,
  input: { organizationSlug: string; eventId: string; scanned: string },
): Promise<CheckInResult> {
  return run("events.check_in", async () => {
    await reserveRequest(db, actor, "scan");
    const { organizationSlug, eventId } = EventRef.parse(input);
    const token = extractToken(z.string().max(500).parse(input.scanned));
    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, organizationSlug);
      assertPermission(access, "event.checkin");
      const [row] = await queryRows(tx, sql`select private.check_in(${eventId}::uuid, ${token}) as v`, CheckInRow);
      if (!row) throw new Error("check_in returned no row");
      return { status: row.v.status, displayName: row.v.display_name, checkedInAt: row.v.checked_in_at };
    });
  });
}

export async function checkInRegistration(
  db: Database,
  actor: VerifiedActor,
  input: { organizationSlug: string; registrationId: string },
): Promise<CheckInResult> {
  return run("events.check_in_manual", async () => {
    const slug = OrganizationSlug.parse(input.organizationSlug);
    const registrationId = z.uuid().parse(input.registrationId);
    return withUserContext(db, actor, async (tx) => {
      const access = await loadOrgAccess(tx, slug);
      assertPermission(access, "event.manage");
      const [row] = await queryRows(tx, sql`select private.check_in_registration(${registrationId}::uuid) as v`, CheckInRow);
      if (!row) throw new Error("check_in_registration returned no row");
      return { status: row.v.status, displayName: row.v.display_name, checkedInAt: row.v.checked_in_at };
    });
  });
}

export interface MyUpcomingEvent {
  eventId: string;
  title: string;
  startsAt: Date;
  venue: string | null;
  organizationSlug: string;
  organizationName: string;
  checkedIn: boolean;
}

/** The caller's registered, not-yet-finished events across all clubs (RLS: own registrations). */
export async function listMyUpcomingEvents(db: Database, actor: VerifiedActor): Promise<MyUpcomingEvent[]> {
  return run("events.list_mine", () =>
    withUserContext(db, actor, async (tx) => {
      const rows = await tx
        .select({
          eventId: events.id,
          title: events.title,
          startsAt: events.startsAt,
          venue: events.venue,
          organizationSlug: organizations.slug,
          organizationName: organizations.name,
          checkedInAt: eventAttendance.checkedInAt,
        })
        .from(eventRegistrations)
        .innerJoin(events, eq(events.id, eventRegistrations.eventId))
        .innerJoin(organizations, eq(organizations.id, events.organizationId))
        .leftJoin(eventAttendance, eq(eventAttendance.registrationId, eventRegistrations.id))
        .where(
          and(
            eq(eventRegistrations.userId, actor.userId),
            eq(eventRegistrations.status, "registered"),
            gte(events.endsAt, new Date()),
          ),
        )
        .orderBy(asc(events.startsAt))
        .limit(20);
      return rows.map(({ checkedInAt, ...r }) => ({ ...r, checkedIn: checkedInAt !== null }));
    }),
  );
}
