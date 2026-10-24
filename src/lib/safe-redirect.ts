const PLACEHOLDER_ORIGIN = "http://placeholder.invalid";

/**
 * Returns `raw` only if it is a same-site path such as "/o/club/dashboard".
 * Anything that could send the browser to another site (absolute URLs,
 * protocol-relative "//evil.example", backslash tricks, control characters)
 * falls back to `fallback`. Prevents open redirects through ?next=.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || raw.length > 512) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;

  try {
    const url = new URL(raw, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
