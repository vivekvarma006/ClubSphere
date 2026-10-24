import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { safeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { log } from "@/server/log";

const OtpType = z.enum(["signup", "invite", "magiclink", "recovery", "email_change", "email"]) satisfies z.ZodType<EmailOtpType>;

/**
 * Landing point for links in Supabase Auth emails (configure the email
 * templates to point here with token_hash and type):
 *   - signup / email: confirms the address (email/password accounts must do
 *     this before they can request membership)
 *   - recovery: signs the user in so they can choose a new password
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = OtpType.safeParse(searchParams.get("type"));
  const fail = (reason: string) => NextResponse.redirect(new URL(`/auth/error?reason=${reason}`, origin));

  if (!tokenHash || !type.success) return fail("invalid_link");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type: type.data, token_hash: tokenHash });

  if (error) {
    log.info("auth.confirm_failed", { type: type.data, status: error.status, code: error.code });
    return fail("link_expired");
  }

  const destination = type.data === "recovery" ? "/auth/update-password" : safeNextPath(searchParams.get("next"));
  return NextResponse.redirect(new URL(destination, origin));
}
