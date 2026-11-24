/**
 * Where a personal API token (`Authorization: Bearer whr_…`) may be used.
 *
 * Shared by the proxy (which lets such requests through without a session cookie or CSRF token) and by the
 * route-level bearer authenticator. Tokens may read (GET/HEAD/OPTIONS) any API route, but on a state-changing
 * request they are accepted only by WebDAV and the single-shot image upload. The proxy alone could not hold
 * that line: it only checks that a session cookie looks plausible and that the CSRF double-submit pair
 * matches, both of which a script can fake, so the route-level authenticator must refuse the token too.
 *
 * Keep this module free of imports: the proxy bundles it.
 */

const SAFE_BEARER_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const BEARER_TOKEN_API_BYPASS: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/api\/health$/ },
  { method: "GET", pattern: /^\/api\/images\/list$/ },
  { method: "POST", pattern: /^\/api\/images\/upload$/ },
];

/** Whether a route accepts an API token for this method (and so may be reached without a session cookie). */
export function canRouteValidateBearerToken(pathname: string, method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (pathname.startsWith("/api/") && SAFE_BEARER_METHODS.has(normalizedMethod)) {
    return true;
  }
  if (pathname.startsWith("/api/webdav/")) {
    return true;
  }
  return BEARER_TOKEN_API_BYPASS.some((entry) => entry.method === normalizedMethod && entry.pattern.test(pathname));
}
