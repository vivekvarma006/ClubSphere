import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

/**
 * In-process PostgreSQL (PGlite, Postgres compiled to WebAssembly) used by
 * the test suites and by the offline demo mode. It runs the same SQL
 * migrations as Supabase, after a small shim that provides the Supabase
 * pieces the schema depends on (auth.users, auth.uid(), API roles).
 */

const SUPABASE_DIR = path.join(process.cwd(), "supabase");
export const MIGRATIONS_DIR = path.join(SUPABASE_DIR, "migrations");
export const SHIM_FILE = path.join(SUPABASE_DIR, "local", "supabase-shim.sql");

/** Opens (or creates) a local Postgres. Omit `dataDir` for an in-memory database. */
export async function openLocalPostgres(dataDir?: string): Promise<PGlite> {
  return PGlite.create({ dataDir, extensions: { vector } });
}

export async function listMigrations(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith(".sql")).sort();
}

/** Creates the Supabase stand-in objects if this database does not have them yet. */
export async function applySupabaseShim(db: PGlite): Promise<void> {
  const { rows } = await db.query("select 1 from pg_namespace where nspname = 'auth'");
  if (rows.length === 0) await db.exec(await readFile(SHIM_FILE, "utf8"));
}

/**
 * Applies migrations in filename order, each in its own transaction.
 * With `track`, applied file names are recorded in local_meta.migrations so
 * a persistent database only receives new ones. Returns the files applied.
 */
export async function applyMigrations(db: PGlite, options: { track?: boolean } = {}): Promise<string[]> {
  let alreadyApplied = new Set<string>();
  if (options.track) {
    await db.exec(`
      create schema if not exists local_meta;
      create table if not exists local_meta.migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );`);
    const { rows } = await db.query<{ name: string }>("select name from local_meta.migrations");
    alreadyApplied = new Set(rows.map((r) => r.name));
  }

  const applied: string[] = [];
  for (const file of await listMigrations()) {
    if (alreadyApplied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.transaction(async (tx) => {
        await tx.exec(sql);
        if (options.track) await tx.query("insert into local_meta.migrations (name) values ($1)", [file]);
      });
    } catch (error) {
      throw new Error(`migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
    applied.push(file);
  }
  return applied;
}
