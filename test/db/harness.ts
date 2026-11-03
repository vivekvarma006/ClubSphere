import { readdir } from "node:fs/promises";
import path from "node:path";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { applyMigrations, applySupabaseShim, openLocalPostgres } from "@/server/db/local-postgres";

export { applyMigrations, listMigrations, MIGRATIONS_DIR } from "@/server/db/local-postgres";
export const ROLLBACK_DIR = path.join(process.cwd(), "supabase", "rollback");

/** Down scripts, newest first: the order to undo migrations in. */
export async function listRollbacks(): Promise<string[]> {
  return (await readdir(ROLLBACK_DIR)).filter((f) => f.endsWith("_down.sql")).sort().reverse();
}

export async function createMigratedDb(): Promise<PGlite> {
  const db = await openLocalPostgres();
  await applySupabaseShim(db);
  await applyMigrations(db);
  return db;
}

let template: Promise<PGlite> | undefined;

/**
 * A clean, fully migrated database. The first call per test file migrates a
 * template; later calls clone it, which is much faster than migrating again.
 */
export async function freshDb(): Promise<PGlite> {
  template ??= createMigratedDb();
  // clone() is typed as PGliteInterface but returns a PGlite instance, which
  // drizzle-orm/pglite requires.
  return (await (await template).clone()) as PGlite;
}

export type Tx = Transaction;

/**
 * Runs `fn` exactly as Supabase would run a request from `userId`: inside a
 * transaction, as the `authenticated` role, with the JWT claims set. RLS and
 * GRANTs apply. Mirrors withUserContext() in src/server/db/user-context.ts.
 */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

/** Runs `fn` as a signed-out visitor using the public API key. */
export async function asAnon<T>(db: PGlite, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    return fn(tx);
  });
}

/** Single-value helper: `select private.fn(...) as v`. */
export async function scalar<T>(tx: Tx | PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const result = await tx.query<{ v: T }>(sql, params);
  const row = result.rows[0];
  if (!row) throw new Error(`no row returned by: ${sql}`);
  return row.v;
}

export interface CaughtPgError {
  code: string;
  message: string;
}

/** Awaits `promise`, expecting it to fail with a Postgres error; returns code and message. */
export async function pgError(promise: Promise<unknown>): Promise<CaughtPgError> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: unknown; message?: unknown };
    return { code: typeof e.code === "string" ? e.code : "", message: String(e.message) };
  }
  throw new Error("expected a database error, but the operation succeeded");
}
