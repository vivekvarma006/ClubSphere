/**
 * Offline demo launcher (works on Windows, macOS and Linux).
 *
 *   npm run demo         development server with demo data
 *   npm run demo:start   production server (run `npm run build` first)
 *   npm run demo:reset   delete the local demo database (re-seeded on next start)
 *
 * Demo mode = local PGlite database + "sign in as" demo accounts. No
 * Supabase project, Docker or internet connection is needed after install.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const command = process.argv[2] ?? "dev";
const dataDir = path.resolve(process.env.DEMO_DATA_DIR ?? ".demo-data");

if (command === "reset") {
  rmSync(dataDir, { recursive: true, force: true });
  console.log(`Removed ${path.relative(process.cwd(), dataDir) || dataDir}. Demo data is re-created on the next start.`);
  process.exit(0);
}

if (process.env.DATABASE_URL) {
  console.error("DATABASE_URL is set. Demo mode only runs against its local throwaway database; unset it first.");
  process.exit(1);
}

// Semantic search works best with the embedding model; fetch it once if missing.
if (!existsSync(path.resolve(".models/potion-base-8M/model.safetensors"))) {
  console.log("Downloading the semantic search model (one time, ~31 MB)...");
  const result = spawnSync(process.execPath, ["scripts/download-model.mjs"], { stdio: "inherit" });
  if (result.status !== 0) console.warn("Model download failed; search will fall back to keyword-style matching.");
}

const port = process.env.PORT ?? "3000";
const nextArgs = command === "start" ? ["start", "--port", port] : ["dev", "--port", port];
const child = spawn("npx", ["next", ...nextArgs], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, AUTH_MODE: "demo", APP_ENV: "development" },
});
child.on("exit", (code) => process.exit(code ?? 0));
