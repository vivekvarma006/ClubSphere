import path from "node:path";
import { tmpdir } from "node:os";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3101);
export default defineConfig({
  testDir: "test/e2e",
  testMatch: "demo-flows.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node node_modules/next/dist/bin/next start --port ${port} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      AUTH_MODE: "demo",
      APP_ENV: "development",
      EMBEDDINGS_PROVIDER: "hash",
      DEMO_SESSION_SECRET: "e2e-only-session-key-never-for-production",
      DEMO_DATA_DIR: path.join(tmpdir(), `clubsphere-e2e-${process.pid}`),
    },
  },
});
