import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/server/env";
import * as schema from "./schema";
import type { Database } from "./types";

// One pool per server process. In development, Next.js re-evaluates modules
// on every edit; keeping the pool on globalThis avoids leaking connections.
const globalForDb = globalThis as typeof globalThis & { __clubsphereDb?: Database };

export function getDb(): Database {
  if (!globalForDb.__clubsphereDb) {
    const env = serverEnv();
    const client = postgres(env.DATABASE_URL, {
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
