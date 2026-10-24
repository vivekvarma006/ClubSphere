import "server-only";
import { z } from "zod";

declare const verifiedActorBrand: unique symbol;

/**
 * A user whose identity has been cryptographically verified by Supabase
 * Auth during this request. Every protected service function takes one.
 *
 * The brand means a plain `{ userId }` object (for example, built from
 * request data) does not type-check where a VerifiedActor is required.
 */
export interface VerifiedActor {
  readonly userId: string;
  readonly email: string | null;
  readonly [verifiedActorBrand]: true;
}

/**
 * Only call with values taken from a verified JWT (see getVerifiedActor in
 * ./session.ts) or in tests.
 */
export function verifiedActor(userId: string, email: string | null): VerifiedActor {
  return { userId: z.uuid().parse(userId), email } as VerifiedActor;
}
