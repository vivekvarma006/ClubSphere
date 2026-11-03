import path from "node:path";
import type { NextConfig } from "next";

// Baseline browser protections for every response. A Content-Security-Policy
// is planned for Phase 2 once the auth screens (and their third-party
// origins) exist; see docs/THREAT_MODEL.md.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Almost every page is per-user, so the explicit-cache model of Cache
  // Components brings no benefit here; pages render dynamically per request.
  reactCompiler: true,
  // Loaded with Node's require at runtime instead of being bundled: PGlite
  // ships WebAssembly and data files it locates relative to itself.
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector", "@huggingface/tokenizers"],
  poweredByHeader: false,
  // Pin tracing to this project even if a lockfile exists in a parent folder.
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
