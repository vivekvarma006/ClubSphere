import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { VerifiedActor } from "@/server/auth/actor";
import type { Database } from "@/server/db/types";
import { queryRows, withUserContext } from "@/server/db/user-context";
import { AppError } from "@/server/errors";
/** Reserve before the operation's transaction: rejected inputs count too. */
export async function reserveRequest(
  db: Database,
  actor: VerifiedActor,
  bucket: "scan" | "membership" | "flag",
) {
  const allowed = await withUserContext(db, actor, async (tx) => {
    const [row] = await queryRows(
      tx,
      sql`select private.reserve_request(${bucket}) as allowed`,
      z.object({ allowed: z.boolean() }),
    );
    return row?.allowed ?? false;
  });
  if (!allowed)
    throw new AppError(
      "CONFLICT",
      "Too many requests. Please wait before trying again.",
    );
}
