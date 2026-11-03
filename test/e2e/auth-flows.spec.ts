import { test } from "@playwright/test";

// Provider end-to-end cases require a staging Supabase project, email capture
// and a Google OAuth test client. The forms and actions are implemented; these
// external provider scenarios remain fixme so the verification gap stays visible.
//
// Enable with E2E_SUPABASE=1 with staging credentials. Use a local stack
// (`supabase start`, which captures emails in Inbucket) or a staging project
// with a Google OAuth test client. Never run against production.

test.describe("authentication provider flows", () => {
  test.skip(!process.env.E2E_SUPABASE, "requires a Supabase project; see docs/TEST_STRATEGY.md");

  test.fixme("email/password sign-up sends a verification email and blocks membership requests until verified", async () => {});
  test.fixme("verifying the email via /auth/confirm allows a membership request", async () => {});
  test.fixme("password recovery link signs the user in and leads to /auth/update-password", async () => {});
  test.fixme("Google sign-in returns through /auth/callback with a session and no membership", async () => {});
  test.fixme("reloading /auth/callback after success keeps the user signed in", async () => {});
  test.fixme("signing in with Google using the email of an existing password account links only after verification", async () => {});
});
