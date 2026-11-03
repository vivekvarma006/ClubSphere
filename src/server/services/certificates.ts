import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/server/db/types";
import { queryRows } from "@/server/db/user-context";
export async function verifyCertificate(db: Database, code: string) {
  if (!/^[0-9a-f]{64}$/.test(code)) return null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role anon`);
    const [row] = await queryRows(
      tx,
      sql`select * from public.verify_certificate(${code})`,
      z.object({
        recipient_name: z.string(),
        event_title: z.string(),
        organization_name: z.string(),
        issued_at: z.coerce.date(),
      }),
    );
    return row ?? null;
  });
}
