import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { log } from "@/server/log";

const DB_TIMEOUT_MS = 2000;
const NO_STORE = { "cache-control": "no-store" };

/**
 * Liveness + database reachability for uptime monitors and deploy checks.
 * Reports status only: no versions, hostnames or error text.
 */
export async function GET() {
  await connection(); // always evaluate at request time, never prerender

  const started = performance.now();
  try {
    await Promise.race([
      getDb().execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS)),
    ]);
    const dbLatencyMs = Math.round(performance.now() - started);
    return Response.json({ status: "ok", db: "ok", dbLatencyMs }, { headers: NO_STORE });
  } catch (error) {
    log.error("health.db_unreachable", { errorName: error instanceof Error ? error.name : typeof error });
    return Response.json({ status: "degraded", db: "unreachable" }, { status: 503, headers: NO_STORE });
  }
}
