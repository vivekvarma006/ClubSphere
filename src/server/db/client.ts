import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDemoDatabase } from "@/server/demo/database";
import { serverEnv } from "@/server/env";
import * as schema from "./schema";
import type { Database } from "./types";

// One pool per server process. In development, Next.js re-evaluates modules
// on every edit; keeping the pool on globalThis avoids leaking connections.
const globalForDb = globalThis as typeof globalThis & { __clubsphereDb?: Database };

/**
 * The application database. Supabase mode: pooled postgres.js connection.
 * Demo mode: the local PGlite database (created and seeded on first use).
 * Either way, service code receives the same driver-independent type.
 */
export async function getDb(): Promise<Database> {
  const env = serverEnv();
  if (env.AUTH_MODE === "demo") return getDemoDatabase();

  if (!globalForDb.__clubsphereDb) {
    const client = postgres(env.DATABASE_URL ?? "", {
      max: env.DATABASE_POOL_MAX,
      // Supabase's transaction pooler (port 6543) does not support prepared
      // statements across transactions.
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
    globalForDb.__clubsphereDb = drizzle(client, { schema });
  }
  return globalForDb.__clubsphereDb;
}
