import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/**
 * Driver-independent database handle. Production uses postgres.js; tests use
 * PGlite. Service code depends only on this type, so the same code path runs
 * in both.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
