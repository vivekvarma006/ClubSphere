import "server-only";
import { notFound, redirect } from "next/navigation";
import type { VerifiedActor } from "@/server/auth/actor";
import { getVerifiedActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import type { Database } from "@/server/db/types";
import { AppError } from "@/server/errors";

/** Signed-in user and database for a page; sends signed-out visitors to /login. */
export async function pageContext(): Promise<{ actor: VerifiedActor; db: Database }> {
  const actor = await getVerifiedActor();
  if (!actor) redirect("/login");
  return { actor, db: await getDb() };
}

/**
 * Awaits a service call for rendering. "Not found" and "forbidden" both
 * render the 404 page, so a page never reveals whether something exists in
 * a club the visitor cannot access.
 */
export async function load<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN") notFound();
      if (error.code === "UNAUTHENTICATED") redirect("/login");
    }
    throw error;
  }
}
