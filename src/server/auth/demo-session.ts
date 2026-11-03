import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { z } from "zod";
import { getDemoPostgres } from "@/server/demo/database";
import { isDemoMode, serverEnv } from "@/server/env";
import { verifiedActor, type VerifiedActor } from "./actor";

/**
 * Demo-mode sessions: an HttpOnly cookie "<userId>.<HMAC-SHA256(userId)>".
 * The HMAC key is DEMO_SESSION_SECRET or a random key generated once and
 * stored in DEMO_DATA_DIR. The cookie cannot be forged without the key, and
 * every call re-checks that the user still exists.
 *
 * Every function here refuses to work outside demo mode.
 */
const COOKIE = "cs_demo_session";
const MAX_AGE_SECONDS = 60 * 60 * 8;

let secretPromise: Promise<Buffer> | undefined;

function assertDemo(): void {
  if (!isDemoMode()) throw new Error("demo sessions are only available when AUTH_MODE=demo");
}

async function loadSecret(): Promise<Buffer> {
  const env = serverEnv();
  if (env.DEMO_SESSION_SECRET) return Buffer.from(env.DEMO_SESSION_SECRET, "utf8");
  const file = path.resolve(env.DEMO_DATA_DIR, "session-secret");
  try {
    return Buffer.from(await readFile(file, "utf8"), "hex");
  } catch {
    const secret = randomBytes(32);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, secret.toString("hex"), { mode: 0o600 });
    return secret;
  }
}

function secret(): Promise<Buffer> {
  secretPromise ??= loadSecret();
  return secretPromise;
}

function sign(key: Buffer, userId: string): string {
  return createHmac("sha256", key).update(`demo-session:${userId}`).digest("base64url");
}

export async function encodeDemoSession(userId: string): Promise<string> {
  const id = z.uuid().parse(userId);
  return `${id}.${sign(await secret(), id)}`;
}

/** Returns the user id if `value` carries a valid signature, otherwise null. */
export async function decodeDemoSession(value: string | undefined): Promise<string | null> {
  if (!value) return null;
  const [id, signature] = value.split(".");
  if (!id || !signature || !z.uuid().safeParse(id).success) return null;
  const expected = Buffer.from(sign(await secret(), id));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

export async function getDemoActor(): Promise<VerifiedActor | null> {
  assertDemo();
  const userId = await decodeDemoSession((await cookies()).get(COOKIE)?.value);
  if (!userId) return null;
  const pg = await getDemoPostgres();
  const { rows } = await pg.query<{ email: string | null }>(
    "select email from auth.users where id = $1 and not is_anonymous",
    [userId],
  );
  const row = rows[0];
  return row ? verifiedActor(userId, row.email) : null;
}

/** Call only from a Server Action or Route Handler. */
export async function startDemoSession(userId: string): Promise<void> {
  assertDemo();
  (await cookies()).set(COOKIE, await encodeDemoSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endDemoSession(): Promise<void> {
  assertDemo();
  (await cookies()).delete(COOKIE);
}
