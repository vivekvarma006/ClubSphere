import { test } from "@playwright/test";

// Browser flows against a real Supabase project. The sign-in, sign-up and
// onboarding screens are built in Phase 2; until then these are tracked as
// fixme so the gap stays visible in every test run.
//
// Enable with E2E_SUPABASE=1 once the screens exist. Use a local stack
// (`supabase start`, which captures emails in Inbucket) or a staging project
// with a Google OAuth test client. Never run against production.

test.describe("authentication flows (Phase 2)", () => {
  test.skip(!process.env.E2E_SUPABASE, "requires a Supabase project; see docs/TEST_STRATEGY.md");

  test.fixme("email/password sign-up sends a verification email and blocks membership requests until verified", async () => {});
  test.fixme("verifying the email via /auth/confirm allows a membership request", async () => {});
  test.fixme("password recovery link signs the user in and leads to /auth/update-password", async () => {});
  test.fixme("Google sign-in returns through /auth/callback with a session and no membership", async () => {});
  test.fixme("reloading /auth/callback after success keeps the user signed in", async () => {});
  test.fixme("signing in with Google using the email of an existing password account links only after verification", async () => {});
});
