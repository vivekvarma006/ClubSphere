import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/public-env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Uses the publishable key plus the user's session cookie, so anything it
 * reads through the Data API is subject to RLS as that user.
 *
 * Create one per request; never share it between requests.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = publicEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. That is fine: proxy.ts
          // refreshes the session on every request before rendering.
        }
      },
    },
  });
}
