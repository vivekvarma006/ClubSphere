import { z } from "zod";

/**
 * Configuration that is safe to ship to the browser. Next.js inlines
 * NEXT_PUBLIC_* values at build time, so each one must be referenced
 * literally (process.env.NEXT_PUBLIC_X), not through a dynamic key.
 *
 * The publishable key only identifies the project; every request it makes
 * is still subject to RLS.
 */
const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;

export function publicEnv(): PublicEnv {
  const result = PublicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Invalid public configuration: ${names}. See .env.example.`);
  }
  return result.data;
}
