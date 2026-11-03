import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * End-to-end tests against a production build (`npm run build` first).
 *
 * Without Supabase credentials only the smoke suite runs. The auth-flow
 * suite needs a real Supabase project (local `supabase start` or staging)
 * and is enabled with E2E_SUPABASE=1; see docs/TEST_STRATEGY.md.
 */
export default defineConfig({
  testDir: "test/e2e",
  testIgnore: "demo-flows.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run start -- --port ${PORT} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
