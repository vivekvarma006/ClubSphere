"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getVerifiedActor } from "@/server/auth/session";
import { log } from "@/server/log";

export interface PasswordUpdateState {
  status: "idle" | "error" | "success";
  message: string;
}

const PasswordInput = z.object({
  password: z.string().min(8, "Use at least 8 characters.").max(128, "Use no more than 128 characters."),
  confirmation: z.string(),
}).refine((value) => value.password === value.confirmation, {
  message: "The passwords do not match.",
});

export async function updatePassword(
  _previousState: PasswordUpdateState,
  formData: FormData,
): Promise<PasswordUpdateState> {
  try {
    const supabase = await createSupabaseServerClient();
    // The action is independently callable: never trust the page or client state.
    if (!(await getVerifiedActor(supabase))) {
      return { status: "error", message: "Your session has expired. Open a new password recovery link." };
    }

    const parsed = PasswordInput.safeParse({
      password: formData.get("password"),
      confirmation: formData.get("confirmation"),
    });
    if (!parsed.success) {
      return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter a valid password." };
    }

    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) {
      log.info("auth.password_update_rejected", { code: error.code, status: error.status });
      const message = error.code === "same_password"
        ? "Choose a password different from your current password."
        : error.code === "weak_password"
          ? "Choose a stronger password that meets your organization's password policy."
          : "Your password could not be updated. Try again or open a new recovery link.";
      return { status: "error", message };
    }

    return { status: "success", message: "Your password has been updated." };
  } catch {
    // Never serialize a provider error, password, or form data back to the browser.
    log.error("auth.password_update_failed");
    return { status: "error", message: "Password recovery is temporarily unavailable. Please try again." };
  }
}
