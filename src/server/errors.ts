import "server-only";
import { ZodError } from "zod";
import { log } from "./log";

/**
 * The only error type that crosses from the server layer to the UI.
 * `publicMessage` is written for end users; nothing from the database
 * (SQL text, parameters, constraint details, stack traces) is ever exposed.
 */
export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "UNAVAILABLE"
  | "INTERNAL";

const HTTP_STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_INPUT: 422,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly publicMessage: string;

  constructor(code: AppErrorCode, publicMessage: string, options?: { cause?: unknown }) {
    super(publicMessage, options);
    this.name = "AppError";
    this.code = code;
    this.publicMessage = publicMessage;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }
}

// ClubSphere procedures raise SQLSTATE class "CS" with messages written for
// users (see supabase/migrations/20261024000100_foundation_helpers.sql).
const CLUBSPHERE_CODES: Record<string, AppErrorCode> = {
  CS401: "UNAUTHENTICATED",
  CS403: "FORBIDDEN",
  CS404: "NOT_FOUND",
  CS409: "CONFLICT",
  CS422: "INVALID_INPUT",
};

const POSTGRES_CODES: Record<string, [AppErrorCode, string]> = {
  "23505": ["CONFLICT", "That already exists."],
  "23503": ["INVALID_INPUT", "A referenced record does not exist."],
  "23502": ["INVALID_INPUT", "A required value is missing."],
  "23514": ["INVALID_INPUT", "Some of the submitted values are not allowed."],
  "22001": ["INVALID_INPUT", "A value is too long."],
  "22P02": ["INVALID_INPUT", "A value has the wrong format."],
  "42501": ["FORBIDDEN", "You do not have permission to do that."],
  "40001": ["CONFLICT", "That changed while you were working. Please try again."],
  "40P01": ["CONFLICT", "That changed while you were working. Please try again."],
  "57014": ["UNAVAILABLE", "The request took too long. Please try again."],
  "53300": ["UNAVAILABLE", "The service is busy. Please try again shortly."],
};

interface PgLikeError {
  code: string;
  message: string;
}

/**
 * Finds the Postgres error inside whatever wrapped it. Drizzle wraps driver
 * errors in DrizzleQueryError, whose own message contains the SQL and its
 * parameters, so we look at `.cause` and never at the wrapper's message.
 */
export function findPgError(error: unknown): PgLikeError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object") {
      const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
      if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
        return { code: candidate.code, message: String(candidate.message ?? "") };
      }
      current = candidate.cause;
    } else {
      return undefined;
    }
  }
  return undefined;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return new AppError("INVALID_INPUT", `${where}${issue?.message ?? "Invalid input."}`, { cause: error });
  }

  const pg = findPgError(error);
  if (pg) {
    const own = CLUBSPHERE_CODES[pg.code];
    if (own) return new AppError(own, capitalize(pg.message), { cause: error });

    const mapped = POSTGRES_CODES[pg.code];
    if (mapped) return new AppError(mapped[0], mapped[1], { cause: error });

    if (pg.code.startsWith("08")) {
      return new AppError("UNAVAILABLE", "The service is temporarily unavailable.", { cause: error });
    }
  }

  return new AppError("INTERNAL", "Something went wrong. Please try again.", { cause: error });
}

/**
 * Converts any failure into an AppError and logs what an operator needs
 * (operation, error code), never SQL, parameters or row values.
 */
export function handleServiceError(operation: string, error: unknown): AppError {
  const appError = toAppError(error);
  const pg = findPgError(error);
  const fields = { operation, code: appError.code, pgCode: pg?.code };
  if (appError.code === "INTERNAL" || appError.code === "UNAVAILABLE") {
    log.error("service.failed", { ...fields, errorName: error instanceof Error ? error.name : typeof error });
  } else {
    log.info("service.rejected", fields);
  }
  return appError;
}

function capitalize(message: string): string {
  const text = message.trim();
  if (!text) return "Request could not be completed.";
  const sentence = text[0]!.toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}
