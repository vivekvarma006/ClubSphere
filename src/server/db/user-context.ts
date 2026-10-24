import { sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { VerifiedActor } from "@/server/auth/actor";
import type { Database, DbTransaction } from "./types";

/**
 * Runs `fn` in a transaction that the database sees as a request from
 * `actor`: the role is switched to `authenticated` and the verified user id
 * is placed where auth.uid() reads it. RLS policies and GRANTs therefore
 * apply to every query inside, exactly as for a Supabase Data API request.
 *
 * Both settings are LOCAL, so they end with the transaction and cannot leak
 * to the next request that reuses the pooled connection.
 *
 * Keep the work inside short: no network calls or user waits while the
 * transaction is open.
 */
export async function withUserContext<T>(
  db: Database,
  actor: VerifiedActor,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: actor.userId, role: "authenticated" });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

/** Normalizes raw `execute()` results across drivers (postgres.js returns an array, PGlite `{ rows }`). */
export function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) {
    return result.rows;
  }
  throw new Error("Unexpected query result shape");
}

/** Executes raw SQL and validates every row with `schema`. */
export async function queryRows<T>(tx: DbTransaction, query: SQL, schema: z.ZodType<T>): Promise<T[]> {
  return rowsOf(await tx.execute(query)).map((row) => schema.parse(row));
}
