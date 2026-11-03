"use server";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/app/action-state";
import { requireVerifiedActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { toAppError } from "@/server/errors";
import {
  deleteCustomRole,
  createClub,
  saveCustomRole,
  saveSettings,
  setClubStatus,
} from "@/server/services/administration";
import { OrganizationSettingsSchema } from "@/server/validation/organization-config";
export async function administrationAction(
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
    if (operation === "settings") {
      const features = Object.fromEntries(
        Object.keys(OrganizationSettingsSchema.parse({}).features).map((k) => [
          k,
          fd.get(`feature.${k}`) === "on",
        ]),
      );
      await saveSettings(db, actor, slug, {
        name: text("name"),
        policy: text("policy"),
        branding: {
          ...(text("color") ? { primaryColor: text("color") } : {}),
          ...(text("shortName") ? { shortName: text("shortName") } : {}),
          ...(text("logoUrl") ? { logoUrl: text("logoUrl") } : {}),
        },
        settings: {
          features,
          notifications: {
            notifyReviewersOnNewRequest: fd.get("notify") === "on",
          },
        },
        domains: text("domains")
          .split(/[\s,]+/)
          .filter(Boolean),
        fields: JSON.parse(text("fields") || "[]"),
      });
    } else if (operation === "deleteRole") {
      if (fd.get("confirm") !== "on")
        return {
          ok: false,
          message: "Confirm removal of the role and its assignments.",
        };
      await deleteCustomRole(db, actor, slug, text("roleId"));
    } else if (operation === "role") {
      await saveCustomRole(db, actor, slug, {
        roleId: text("roleId") || null,
        key: text("key"),
        name: text("name"),
        permissions: fd.getAll("permissions"),
      });
    } else if (operation === "club")
      await createClub(db, actor, {
        slug: text("slug"),
        name: text("name"),
        ownerId: text("ownerId"),
      });
    else if (operation === "status")
      await setClubStatus(db, actor, text("organizationId"), text("status"));
    else return { ok: false, message: "Unknown operation." };
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof SyntaxError
          ? "Enter valid JSON for profile questions."
          : toAppError(e).publicMessage,
    };
  }
}
