import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws when imported outside a React Server Component
      // bundle. Tests run server code directly in Node, so stub it out.
      "server-only": path.resolve(import.meta.dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**", "node_modules/**"],
    // Each DB test file migrates its own PGlite template (~1-3 s).
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
