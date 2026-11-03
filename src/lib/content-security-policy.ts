/** Build a per-response nonce policy. Connections are same-origin because auth
 * and embeddings run server-side. Development also needs HMR and eval. */
export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  supabaseUrl?: string,
) {
  let authOrigin = "";
  try {
    const url = new URL(supabaseUrl ?? "");
    if (url.protocol === "https:" || url.protocol === "http:")
      authOrigin = ` ${url.origin}`;
  } catch {
    /* Missing/invalid provider configuration grants no external form origin. */
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // Club branding uses inline CSS custom properties. Scripts still require a nonce.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    // Server Actions initiate OAuth with a cross-origin redirect.
    `form-action 'self' https://accounts.google.com${authOrigin}`,
  ].join("; ");
}
