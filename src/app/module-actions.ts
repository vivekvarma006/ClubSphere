"use server";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/action-state";
import { requireVerifiedActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { toAppError } from "@/server/errors";
import * as operations from "@/server/services/operations";

export async function moduleAction(
  slug: string,
  operation: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const text = (key: string) =>
    typeof fd.get(key) === "string" ? (fd.get(key) as string) : "";
  try {
    const db = await getDb(),
      actor = await requireVerifiedActor();
    let message = "Saved.";
    switch (operation) {
      case "stock":
        await operations.adjustInventory(db, actor, slug, {
          itemId: text("itemId") || undefined,
          name: text("name"),
          delta: text("delta"),
          reason: text("reason"),
        });
        break;
      case "slot":
        await operations.createMealSlot(db, actor, slug, {
          eventId: text("eventId"),
          itemId: text("itemId"),
          name: text("name"),
        });
        break;
      case "task":
        await operations.createTask(db, actor, slug, {
          title: text("title"),
          description: text("description"),
          eventId: text("eventId") || undefined,
          dueAt: text("dueAt") || undefined,
        });
        break;
      case "assign":
        await operations.assignTask(
          db,
          actor,
          slug,
          text("taskId"),
          text("membershipId"),
        );
        break;
      case "complete":
        await operations.completeTask(db, actor, slug, text("taskId"));
        message = "Task completed.";
        break;
      case "challenge":
        await operations.createChallenge(db, actor, slug, {
          eventId: text("eventId"),
          title: text("title"),
          description: text("description"),
          points: text("points"),
          flag: text("flag"),
        });
        break;
      case "flag": {
        const status = await operations.submitFlag(
          db,
          actor,
          slug,
          text("challengeId"),
          text("flag"),
        );
        message =
          status === "solved"
            ? "Correct! Points awarded."
            : status === "already_solved"
              ? "Already solved: no extra points."
              : "Incorrect flag.";
        break;
      }
      case "certificates":
        await operations.issueCertificates(db, actor, slug, text("eventId"));
        message =
          "Certificates issued for attendees. Existing certificates kept.";
        break;
      case "feedback":
      case "writeup":
        await operations.submitMemberDocument(db, actor, slug, {
          kind: operation,
          targetId: text("targetId"),
          body: text("body"),
          rating: text("rating"),
        });
        message = "Published to the knowledge base.";
        break;
      default:
        return { ok: false, message: "Unknown operation." };
    }
    revalidatePath(`/o/${slug}`, "layout");
    return { ok: true, message };
  } catch (error) {
    return { ok: false, message: toAppError(error).publicMessage };
  }
}

export async function claimMealAction(
  slug: string,
  eventId: string,
  slotId: string,
  scanned: string,
) {
  try {
    const result = await operations.claimMeal(
      await getDb(),
      await requireVerifiedActor(),
      slug,
      { eventId, slotId, scanned },
    );
    revalidatePath(`/o/${slug}`, "layout");
    return {
      ok: true as const,
      status: result.status,
      name: result.display_name,
      at: new Date().toISOString(),
    };
  } catch (error) {
    return { ok: false as const, message: toAppError(error).publicMessage };
  }
}
