import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps the Supabase session fresh: if the access token is about to expire,
 * getClaims() refreshes it and the new cookies are written to the response.
 *
 * This is NOT an authorization layer. Every protected page, action and route
 * re-verifies the user in the server Data Access Layer (src/server), because
 * a proxy can be bypassed or misconfigured and must never be the only check.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (process.env.AUTH_MODE === "demo") return response; // demo sessions need no refresh

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response; // not configured; pages will report it

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // no-store headers: a CDN must never cache a response carrying someone's session.
        for (const [header, value] of Object.entries(headers)) response.headers.set(header, value);
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
