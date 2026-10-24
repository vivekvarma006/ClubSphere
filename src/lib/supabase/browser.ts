import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/public-env";

/**
 * Browser-side Supabase client, used only for Auth flows (sign-in, sign-up,
 * OAuth redirect). Application data is read and written through the server.
 */
export function createSupabaseBrowserClient() {
  const env = publicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
