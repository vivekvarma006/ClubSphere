"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { VerifiedActor } from "@/server/auth/actor";
import type { DocumentSourceType, EventCategory } from "@/server/db/schema";
import { endDemoSession, startDemoSession } from "@/server/auth/demo-session";
import { requireVerifiedActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import type { Database } from "@/server/db/types";
import { createDemoUser } from "@/server/demo/personas";
import { isDemoMode } from "@/server/env";
import { toAppError } from "@/server/errors";
import {
  checkInByToken,
  checkInRegistration,
  cancelRegistration,
  createEvent,
  registerForEvent,
  setEventStatus,
} from "@/server/services/events";
import { saveDocument } from "@/server/services/knowledge-base";
import { reviewMembershipRequest, submitMembershipRequest, withdrawMembershipRequest } from "@/server/services/memberships";
import type { ActionState } from "./action-state";

/**
 * Server Actions. Each one re-verifies the caller (never trusting the
 * page that rendered the form), delegates to a service that validates and
 * authorizes, and turns failures into a user-safe message.
 */
async function act(
  fn: (ctx: { actor: VerifiedActor; db: Database }) => Promise<string>,
  revalidate: string = "/",
): Promise<ActionState> {
  let message: string;
  try {
    message = await fn({ actor: await requireVerifiedActor(), db: await getDb() });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === "UNAUTHENTICATED") redirect("/login");
    return { ok: false, message: appError.publicMessage };
  }
  revalidatePath(revalidate, "layout");
  return { ok: true, message };
}

const text = (fd: FormData, key: string) => {
  const value = fd.get(key);
  return typeof value === "string" ? value : "";
};

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function signInAsDemoUser(formData: FormData): Promise<void> {
  if (!isDemoMode()) redirect("/login");
  const userId = z.uuid().safeParse(text(formData, "userId"));
  if (!userId.success) redirect("/login");
  await startDemoSession(userId.data);
  redirect("/dashboard");
}

export async function createDemoAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  let userId: string;
  try {
    userId = await createDemoUser({ displayName: text(formData, "displayName"), email: text(formData, "email") });
  } catch (error) {
    return { ok: false, message: toAppError(error).publicMessage };
  }
  await startDemoSession(userId);
  redirect("/join");
}

export async function signOut(): Promise<void> {
  if (isDemoMode()) {
    await endDemoSession();
  } else {
    await (await createSupabaseServerClient()).auth.signOut();
  }
  redirect("/login");
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export async function requestToJoin(slug: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const answers: Record<string, string | number> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("answer.") || typeof value !== "string" || value.trim() === "") continue;
    const field = key.slice("answer.".length);
    const numeric = formData.get(`type.${field}`) === "number";
    answers[field] = numeric ? Number(value) : value.trim();
  }
  const result = await act(async ({ actor, db }) => {
    await submitMembershipRequest(db, actor, { organizationSlug: slug, answers });
    return "Request sent.";
  });
  if (result?.ok) redirect("/dashboard?requested=1");
  return result;
}

export async function withdrawRequest(requestId: string): Promise<void> {
  await act(async ({ actor, db }) => {
    await withdrawMembershipRequest(db, actor, { requestId });
    return "Withdrawn.";
  });
}

export async function reviewRequest(
  slug: string,
  requestId: string,
  decision: "approve" | "reject",
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return act(async ({ actor, db }) => {
    const reason = text(formData, "reason").trim();
    if (decision === "approve") {
      await reviewMembershipRequest(db, actor, { decision, organizationSlug: slug, requestId });
      return "Approved: they are now a member.";
    }
    await reviewMembershipRequest(db, actor, { decision, organizationSlug: slug, requestId, reason: reason || undefined });
    return "Rejected.";
  }, `/o/${slug}`);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function registerForEventAction(slug: string, eventId: string): Promise<ActionState> {
  return act(async ({ actor, db }) => {
    await registerForEvent(db, actor, { organizationSlug: slug, eventId });
    return "You're registered. Your QR code is below.";
  }, `/o/${slug}`);
}

export async function cancelRegistrationAction(slug: string, registrationId: string): Promise<ActionState> {
  return act(async ({ actor, db }) => {
    await cancelRegistration(db, actor, registrationId);
    return "Registration cancelled.";
  }, `/o/${slug}`);
}

export async function createEventAction(slug: string, _: ActionState, formData: FormData): Promise<ActionState> {
  let eventId = "";
  const result = await act(async ({ actor, db }) => {
    const created = await createEvent(db, actor, {
      organizationSlug: slug,
      title: text(formData, "title"),
      description: text(formData, "description"),
      // Validated against the allowed values by the service (Zod).
      category: text(formData, "category") as EventCategory,
      venue: text(formData, "venue") || undefined,
      startsAt: text(formData, "startsAt"),
      endsAt: text(formData, "endsAt"),
      capacity: text(formData, "capacity") || undefined,
      publish: formData.get("publish") === "on",
    });
    eventId = created.eventId;
    return "Event created.";
  }, `/o/${slug}`);
  if (result?.ok) redirect(`/o/${slug}/events/${eventId}`);
  return result;
}

export async function setEventStatusAction(
  slug: string,
  eventId: string,
  status: "published" | "completed" | "cancelled",
): Promise<ActionState> {
  return act(async ({ actor, db }) => {
    await setEventStatus(db, actor, { organizationSlug: slug, eventId, status });
    return `Event ${status}.`;
  }, `/o/${slug}`);
}

export type CheckInState = { ok: true; status: "checked_in" | "already_checked_in"; name: string; at: string } | { ok: false; message: string };

/** Called by the QR scanner for each decoded code. */
export async function checkInAction(slug: string, eventId: string, scanned: string): Promise<CheckInState> {
  try {
    const result = await checkInByToken(await getDb(), await requireVerifiedActor(), { organizationSlug: slug, eventId, scanned });
    revalidatePath(`/o/${slug}/events/${eventId}`);
    return { ok: true, status: result.status, name: result.displayName, at: result.checkedInAt };
  } catch (error) {
    return { ok: false, message: toAppError(error).publicMessage };
  }
}

export async function manualCheckInAction(slug: string, registrationId: string): Promise<ActionState> {
  return act(async ({ actor, db }) => {
    const result = await checkInRegistration(db, actor, { organizationSlug: slug, registrationId });
    return result.status === "checked_in" ? `${result.displayName} checked in.` : `${result.displayName} was already checked in.`;
  }, `/o/${slug}`);
}

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

export async function saveDocumentAction(slug: string, _: ActionState, formData: FormData): Promise<ActionState> {
  return act(async ({ actor, db }) => {
    await saveDocument(db, actor, {
      organizationSlug: slug,
      title: text(formData, "title"),
      sourceType: text(formData, "sourceType") as DocumentSourceType,
      body: text(formData, "body"),
      visibility: text(formData, "visibility") === "officers" ? "officers" : "members",
    });
    return "Document published and indexed for search.";
  }, `/o/${slug}`);
}
