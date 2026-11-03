"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/app/action-state";
import { safeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/server/env";
import { log } from "@/server/log";

const Email = z.email().max(254);
const Password = z.string().min(8, "Use at least 8 characters.").max(128);
const Credentials = z.object({ email: Email, password: Password });
const Signup = Credentials.extend({
  displayName: z.string().trim().min(2).max(60),
  confirmation: z.string(),
}).refine((v) => v.password === v.confirmation, {
  message: "The passwords do not match.",
});
const unavailable: ActionState = {
  ok: false,
  message: "Sign-in is temporarily unavailable. Please try again.",
};

// A configured origin avoids trusting a caller-controlled Host header in email links.
function callback(next: string) {
  const base = z
    .url({ protocol: /^https?$/ })
    .parse(
      process.env.APP_URL ??
        (process.env.APP_ENV === "production" ? "" : "http://localhost:3000"),
    );
  if (process.env.APP_ENV === "production" && !base.startsWith("https://"))
    throw new Error("HTTPS origin required");
  const url = new URL("/auth/callback", base);
  url.searchParams.set("next", next);
  return url.href;
}

export async function login(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (isDemoMode()) return unavailable;
  const parsed = Credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      ok: false,
      message: "Enter a valid email and a password of 8–128 characters.",
    };
  try {
    const { error } = await (
      await createSupabaseServerClient()
    ).auth.signInWithPassword(parsed.data);
    if (error)
      return {
        ok: false,
        message:
          "Unable to sign in. Check your email and password and confirm your email address.",
      };
  } catch {
    log.error("auth.login_failed");
    return unavailable;
  }
  redirect(safeNextPath(formData.get("next")?.toString(), "/dashboard"));
}

export async function signup(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (isDemoMode()) return unavailable;
  const parsed = Signup.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check your details.",
    };
  let signedIn = false;
  try {
    const { email, password, displayName } = parsed.data;
    const { data, error } = await (
      await createSupabaseServerClient()
    ).auth.signUp({
      email,
      password,
      options: {
        data: { full_name: displayName },
        emailRedirectTo: callback("/dashboard"),
      },
    });
    if (error)
      return {
        ok: false,
        message:
          "Unable to create an account. Check your details or try signing in.",
      };
    signedIn = Boolean(data.session);
  } catch {
    log.error("auth.signup_failed");
    return unavailable;
  }
  if (signedIn) redirect("/dashboard");
  return {
    ok: true,
    message:
      "Check your email for a confirmation link. If you already have an account, sign in.",
  };
}

export async function forgotPassword(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (isDemoMode()) return unavailable;
  const parsed = Email.safeParse(formData.get("email"));
  if (!parsed.success)
    return { ok: false, message: "Enter a valid email address." };
  try {
    await (
      await createSupabaseServerClient()
    ).auth.resetPasswordForEmail(parsed.data, {
      redirectTo: callback("/auth/update-password"),
    });
  } catch {
    log.error("auth.recovery_request_failed");
    return unavailable;
  }
  // Identical response for unknown addresses and provider rejections.
  return {
    ok: true,
    message:
      "If an account exists for that email, you will receive a password reset link.",
  };
}

export async function googleLogin(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (isDemoMode()) return unavailable;
  let destination: string;
  try {
    const { data, error } = await (
      await createSupabaseServerClient()
    ).auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback(
          safeNextPath(formData.get("next")?.toString(), "/dashboard"),
        ),
      },
    });
    if (error || !data.url) return unavailable;
    destination = data.url;
  } catch {
    log.error("auth.google_login_failed");
    return unavailable;
  }
  redirect(destination);
}
