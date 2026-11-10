import "server-only";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { applyMigrations, applySupabaseShim, openLocalPostgres } from "@/server/db/local-postgres";
import * as schema from "@/server/db/schema";
import type { Database } from "@/server/db/types";
import { serverEnv } from "@/server/env";
import { log } from "@/server/log";
import { seedDemoData } from "./seed";
import { ensureDemoShowcase } from "./showcase";

/**
 * Demo mode's database: a PGlite data directory under DEMO_DATA_DIR. On
 * first use it applies the Supabase shim, any migrations not yet applied,
 * and the demo seed. Delete the directory (`npm run demo:reset`) to start
 * over.
 */
interface DemoRuntime {
  pg: PGlite;
  db: Database;
}

const globalForDemo = globalThis as typeof globalThis & {
  __clubsphereDemo?: Promise<DemoRuntime>;
  __clubsphereDemoShowcase20261109?: Promise<void>;
};

async function start(): Promise<DemoRuntime> {
  const env = serverEnv();
  const dataDir = path.resolve(env.DEMO_DATA_DIR, "pgdata");
  await mkdir(path.dirname(dataDir), { recursive: true });

  const pg = await openLocalPostgres(dataDir);
  await applySupabaseShim(pg);
  const applied = await applyMigrations(pg, { track: true });
  if (applied.length > 0) log.info("demo.migrations_applied", { count: applied.length });

  // drizzle-orm/pglite needs the concrete PGlite class; openLocalPostgres returns one.
  const db = drizzle(pg, { schema }) as unknown as Database;

  const { rows } = await pg.query<{ n: number }>("select count(*)::int as n from public.organizations");
  if ((rows[0]?.n ?? 0) === 0) {
    log.info("demo.seeding");
    await seedDemoData(pg);
    log.info("demo.seeded");
  }
  return { pg, db };
}

function runtime(): Promise<DemoRuntime> {
  globalForDemo.__clubsphereDemo ??= start().catch((error: unknown) => {
    globalForDemo.__clubsphereDemo = undefined; // allow a retry after fixing the cause
    throw error;
  });
  return globalForDemo.__clubsphereDemo.then(async runtime => {
    // Also upgrade a runtime retained across development hot reloads.
    globalForDemo.__clubsphereDemoShowcase20261109 ??= ensureDemoShowcase(runtime.pg).catch((error: unknown) => {
      globalForDemo.__clubsphereDemoShowcase20261109 = undefined;
      throw error;
    });
    await globalForDemo.__clubsphereDemoShowcase20261109;
    return runtime;
  });
}

export async function getDemoDatabase(): Promise<Database> {
  return (await runtime()).db;
}

/** Superuser access for demo-only operations (persona list, demo sign-up). */
export async function getDemoPostgres(): Promise<PGlite> {
  return (await runtime()).pg;
}
