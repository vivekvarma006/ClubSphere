import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
export const ROLLBACK_FILE = path.join(ROOT, "supabase", "rollback", "20261024_foundation_down.sql");
const SHIM_FILE = path.join(import.meta.dirname, "supabase-shim.sql");

export async function listMigrations(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith(".sql")).sort();
}

/** Applies every migration in filename order. Each file runs as one implicit transaction. */
export async function applyMigrations(db: PGlite): Promise<void> {
  for (const file of await listMigrations()) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
  }
}

export async function createMigratedDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(await readFile(SHIM_FILE, "utf8"));
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
