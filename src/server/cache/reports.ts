import "server-only";
import { createClient } from "redis";
import type { z } from "zod";
import { log } from "@/server/log";

export const REPORT_TTL_SECONDS = 30;

/** Separate NoSQL store for disposable JSON snapshots, never authoritative data.
 * Short-lived connections bound failures and avoid retaining broken clients.
 * Network calls happen outside PostgreSQL transactions.
 */
async function withRedis<T>(fn: (client: ReturnType<typeof createClient>) => Promise<T>): Promise<T | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  let client: ReturnType<typeof createClient> | undefined;
  try {
    client = createClient({
      url,
      disableOfflineQueue: true,
      socket: { connectTimeout: 500, reconnectStrategy: false },
    });
    client.on("error", () => {}); // Errors are handled below; never log a URL/password.
    await client.connect();
    return await fn(client);
  } catch {
    log.warn("reports.cache_unavailable");
    return null;
  } finally {
    if (client?.isOpen) client.destroy();
  }
}

export async function readReportCache<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
  return withRedis(async (client) => {
    const raw = await client.withCommandOptions({ timeout: 500 }).get(key);
    if (!raw) return null;
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch { return null; }
  });
}

export async function writeReportCache(key: string, value: unknown): Promise<void> {
  await withRedis((client) => client.withCommandOptions({ timeout: 500 })
    .set(key, JSON.stringify(value), { EX: REPORT_TTL_SECONDS }));
}
