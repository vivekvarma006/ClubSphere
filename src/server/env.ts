import "server-only";
import { z } from "zod";

/**
 * Deployment configuration (one set per environment: development, staging,
 * production). Organization-specific settings do NOT belong here; they live
 * in the organizations table.
 *
 * Parsed lazily on first use so `next build` does not need runtime secrets.
 */
const ServerEnvSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  // Pooled connection string (Supabase "transaction" pooler, port 6543).
  DATABASE_URL: z
    .url()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), "must start with postgres:// or postgresql://"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | undefined;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = ServerEnvSchema.safeParse(source);
  if (!result.success) {
    // Report variable NAMES only. Values may be secrets.
    const names = [...new Set(result.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Invalid server configuration: ${names}. See .env.example.`);
  }
  return result.data;
}

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
