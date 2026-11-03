import "server-only";
import { z } from "zod";

/**
 * Deployment configuration (one set per environment). Organization-specific
 * settings do NOT belong here; they live in the organizations table.
 *
 * Two runtime modes:
 *   supabase  real deployment: Supabase Auth + Postgres via DATABASE_URL
 *   demo      offline demonstration: local PGlite database in DEMO_DATA_DIR
 *             and "sign in as" demo users. Refuses to start with a
 *             DATABASE_URL or with APP_ENV=production, so demo identities
 *             can never reach real data.
 *
 * Parsed lazily on first use so `next build` does not need runtime secrets.
 */
const ServerEnvSchema = z
  .object({
    APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
    AUTH_MODE: z.enum(["supabase", "demo"]).default("supabase"),
    // Pooled connection string (Supabase "transaction" pooler, port 6543).
    DATABASE_URL: z
      .url()
      .refine((value) => /^postgres(ql)?:\/\//.test(value), "must start with postgres:// or postgresql://")
      .optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    DEMO_DATA_DIR: z.string().min(1).default(".demo-data"),
    DEMO_SESSION_SECRET: z.string().min(32).optional(),
    // "static": Model2Vec static embeddings (needs `npm run models:download`)
    // "hash":   lexical feature hashing, no model files (tests, CI)
    EMBEDDINGS_PROVIDER: z.enum(["static", "hash"]).default("static"),
    EMBEDDINGS_MODEL_DIR: z.string().min(1).default(".models/potion-base-8M"),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === "supabase" && !env.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "required when AUTH_MODE=supabase" });
    }
    if (env.AUTH_MODE === "demo" && env.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "must not be set in demo mode" });
    }
    if (env.AUTH_MODE === "demo" && env.APP_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["AUTH_MODE"], message: "demo mode is not allowed in production" });
    }
  });

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | undefined;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = ServerEnvSchema.safeParse(source);
  if (!result.success) {
    // Report variable NAMES and rules only. Values may be secrets.
    const problems = [...new Set(result.error.issues.map((i) => `${i.path.join(".")} (${i.message})`))].join(", ");
    throw new Error(`Invalid server configuration: ${problems}. See .env.example.`);
  }
  return result.data;
}

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/** Cheap mode check that does not require the rest of the configuration to be valid. */
export function isDemoMode(): boolean {
  return process.env.AUTH_MODE === "demo";
}
