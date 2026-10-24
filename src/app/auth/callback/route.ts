import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getVerifiedActor } from "@/server/auth/session";
import { log } from "@/server/log";

/**
 * OAuth (Google) and PKCE email-link landing point: exchanges the one-time
 * `code` for a session cookie, then sends the user to a SAME-SITE `next`.
 *
 * Signing in only creates a session. It never creates a membership or
 * grants a role; that requires a reviewed membership request.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const fail = (reason: string) => NextResponse.redirect(new URL(`/auth/error?reason=${reason}`, origin));

  if (searchParams.get("error")) {
    log.info("auth.callback_provider_error", { error: searchParams.get("error") });
    return fail("provider");
  }

  const code = searchParams.get("code");
  if (!code) return fail("missing_code");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // A refresh or double-click replays an already-used code. If the first
    // attempt succeeded the user is signed in, so just continue.
    if (await getVerifiedActor(supabase)) return NextResponse.redirect(new URL(next, origin));
    log.warn("auth.callback_exchange_failed", { status: error.status, code: error.code });
    return fail("exchange_failed");
  }

  return NextResponse.redirect(new URL(next, origin));
}
