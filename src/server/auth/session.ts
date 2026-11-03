import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";
import { verifiedActor, type VerifiedActor } from "./actor";
import { getDemoActor } from "./demo-session";

const ClaimsSchema = z.object({
  sub: z.uuid(),
  role: z.literal("authenticated"),
  email: z.string().optional(),
  is_anonymous: z.boolean().optional(),
});

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Step 1 of every protected operation: establish who is calling.
 *
 * Supabase mode: getClaims() verifies the access token's signature (locally
 * against the project's JWKS when asymmetric signing keys are enabled,
 * otherwise via the Auth server). getSession() is NOT used for this: it
 * returns whatever is in the cookie without verifying it. Anonymous
 * Supabase sessions are treated as signed out.
 *
 * Demo mode: a signed demo-session cookie (see ./demo-session.ts).
 */
export async function getVerifiedActor(client?: SupabaseServerClient): Promise<VerifiedActor | null> {
  if (!client && isDemoMode()) return getDemoActor();

  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;

  const claims = ClaimsSchema.safeParse(data.claims);
  if (!claims.success || claims.data.is_anonymous) return null;

  return verifiedActor(claims.data.sub, claims.data.email ?? null);
}

export async function requireVerifiedActor(client?: SupabaseServerClient): Promise<VerifiedActor> {
  const actor = await getVerifiedActor(client);
  if (!actor) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
  return actor;
}
