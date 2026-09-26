/**
 * Cross-origin detection for pre-session form posts (login CSRF defence).
 *
 * `/api/login` is exempt from the double-submit CSRF check in `proxy.ts` —
 * there is no session yet to mint a token from — which opens the classic
 * login-CSRF window: a third-party page can auto-submit a top-level form
 * with the *attacker's* credentials, and the browser will store the
 * `Set-Cookie` from the response, silently swapping the victim into the
 * attacker's account.
 *
 * The same-origin signals below close that window without breaking
 * non-browser clients (curl, health probes), which send none of these
 * headers and are allowed through.
 */

function expectedRequestHost(request: Request): string {
  // Behind a reverse proxy the authoritative host is x-forwarded-host; the
  // first entry is the client-supplied one, matching the x-forwarded-proto
  // convention in request-https.ts.
  const forwarded = request.headers.get("x-forwarded-host");
  const forwardedHost = forwarded?.split(",")[0]?.trim().toLowerCase();
  if (forwardedHost) return forwardedHost;
  const host = request.headers.get("host");
  if (host) return host.trim().toLowerCase();
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return "";
  }
}

function isHostMismatch(request: Request, headerValue: string): boolean {
  try {
    const originHost = new URL(headerValue).host.toLowerCase();
    const expected = expectedRequestHost(request);
    // An empty expectation means we cannot anchor a comparison; do not reject.
    if (!originHost || !expected) return false;
    return originHost !== expected;
  } catch {
    // A browser Origin/Referer should always be a URL. Fail closed when a
    // host is available instead of treating malformed evidence as same-origin.
    return Boolean(expectedRequestHost(request));
  }
}

/**
 * True when the request carries explicit evidence that it was initiated
 * from a different site (browser navigation or fetch).
 *
 * Resolution order:
 *  1. `Sec-Fetch-Site: cross-site` fails immediately.
 *  2. `Origin` — sent on all cross-origin and same-origin POSTs; compared
 *     against the request's own host.
 *  3. `Referer` — legacy fallback with the same host comparison.
 * A `same-site` fetch can still come from an untrusted sibling subdomain,
 * so its Origin must also pass the host check.
 *
 * Requests with none of these headers (non-browser clients) are not
 * considered cross-site: login CSRF requires a browser victim.
 */
export function isCrossSiteFormPost(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "cross-site") return true;

  const origin = request.headers.get("origin");
  if (origin === "null") return true;
  if (origin) {
    return isHostMismatch(request, origin);
  }

  const referer = request.headers.get("referer");
  if (referer) {
    return isHostMismatch(request, referer);
  }

  return false;
}
