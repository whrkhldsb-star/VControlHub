import { getSessionCookieName as getRuntimeSessionCookieName } from "@/lib/auth/session";
import { timingSafeEqualString } from "@/lib/security/timing-safe-equal";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Global authentication guard + security headers middleware.
 *
 * Auth strategy:
 * - Public paths (login, static, API public endpoints) are allowed through.
 * - All other requests must carry a valid-looking session cookie.
 * - The middleware only checks cookie PRESENCE and basic format — full
 *   HMAC verification happens in each API route via requireSession().
 *   This two-layer approach ensures pages are never rendered for anonymous
 *   users while keeping the Edge-compatible middleware lightweight.
 */

// ── Public paths that skip auth ──────────────────────────────────
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const PUBLIC_PATHS_EXACT = new Set([
  "/login",
  "/login/verify-2fa",
  "/api/login",
  "/api/auth/2fa/verify-login",
  "/status",
  "/api/status",
  // TR-033 PWA: service worker + manifest + offline fallback must be reachable
  // without an auth cookie. Browsers fetch them from <link rel="manifest"> /
  // <link rel="icon"> tags and the service worker scope, never with cookies.
  "/sw.js",
  "/manifest.webmanifest",
  "/offline",
]);

const PUBLIC_PATH_PREFIXES = [
  "/_next", // static assets
  "/api/public", // public API endpoints
  "/api/share/", // public share-token downloads (validated server-side)
  // ITSM inbound webhooks: no session cookie; HMAC signature verified in route.
  "/api/itsm/inbound/",
  "/favicon.ico",
  "/icon.png", // branding app icon (also reused as 512x512 PWA splash)
  "/icon-192x192.png", // PWA home-screen icon (TR-033)
  "/apple-icon.png",
  "/share/", // share token pages (validated server-side)
];

function isPublicPath(pathname: string, method = "GET"): boolean {
  if (PUBLIC_PATHS_EXACT.has(pathname)) return true;
  if (
    SAFE_METHODS.has(method.toUpperCase()) &&
    /^\/api\/images\/[^/]+\/file$/.test(pathname)
  ) {
    return true;
  }
  return PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

// ── Session cookie check ─────────────────────────────────────────
function getSessionCookieName(): string {
  return getRuntimeSessionCookieName();
}

function hasValidSessionCookie(request: NextRequest): boolean {
  const cookieName = getSessionCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return false;
  // Basic format check: base64url.encodedPayload.signature
  // Full HMAC verification happens server-side in requireSession()
  return token.includes(".") && token.length > 20;
}

// ── Security headers ─────────────────────────────────────────────
function addSecurityHeaders(
  response: NextResponse,
  request: NextRequest,
  nonce?: string,
): NextResponse {
  const headers = response.headers;

  // Prevent clickjacking
  headers.set("X-Frame-Options", "SAMEORIGIN");

  // Prevent MIME type sniffing
  headers.set("X-Content-Type-Options", "nosniff");

  // Enable XSS filter in older browsers
  headers.set("X-XSS-Protection", "1; mode=block");

  // Referrer policy
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions policy — deny unnecessary features
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );

  // HSTS — only add when the request is already HTTPS
  if (requestUrlIsHttps(request)) {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }

  if (nonce) headers.set("Content-Security-Policy", buildContentSecurityPolicy(nonce));

  return response;
}

function buildContentSecurityPolicy(nonce: string) {
	return [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://cdn.jsdelivr.net https://static.cloudflareinsights.com`,
		// Tailwind and several existing components still use inline style attributes.
		"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
		// 2FA QR is a same-origin data: URL from /api/auth/2fa/setup (no third-party QR hosts).
		"img-src 'self' data: blob:",
		"font-src 'self' data: https://fonts.scalar.com",
		"connect-src 'self' ws: wss:",
		"media-src 'self' blob:",
		"frame-src 'self'",
		"frame-ancestors 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join("; ");
}

const BEARER_TOKEN_API_BYPASS: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/api\/health$/ },
  { method: "GET", pattern: /^\/api\/images\/list$/ },
  { method: "POST", pattern: /^\/api\/images\/upload$/ },
];

function canRouteValidateBearerToken(pathname: string, method: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return BEARER_TOKEN_API_BYPASS.some((entry) => entry.method === normalizedMethod && entry.pattern.test(pathname));
}

function requestUrlIsHttps(request: NextRequest): boolean {
  // Check if the original request was HTTPS via the X-Forwarded-Proto header
  // (set by reverse proxies like Caddy/Apache) or the URL protocol
  const proto = request.headers.get("x-forwarded-proto");
  if (proto === "https") return true;
  // Also check the request URL directly
  return request.nextUrl.protocol === "https:";
}

// ── Main middleware ───────────────────────────────────────────────
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
	const nonce = process.env.NODE_ENV === "production"
		? btoa(crypto.randomUUID())
		: undefined;
	const forwardedHeaders = new Headers(request.headers);
	if (nonce) {
		forwardedHeaders.set("x-nonce", nonce);
		forwardedHeaders.set("Content-Security-Policy", buildContentSecurityPolicy(nonce));
	}
  const hasBearerToken =
    request.headers
      .get("authorization")
      ?.trim()
      .toLowerCase()
      .startsWith("bearer ") ?? false;
  const routeCanValidateBearerToken = hasBearerToken && canRouteValidateBearerToken(pathname, request.method);

  // Login is public, but authenticated operators can still navigate there
  // (for example after changing default-page preferences) and should not see
  // the protected shell/sidebar behind the sign-in form. Server layouts read
  // request headers, so forward the marker on the request, not only the response.
  if (pathname === "/login" || pathname === "/login/verify-2fa") {
    forwardedHeaders.set("x-vcontrolhub-public-auth-page", "1");
    const response = NextResponse.next({
      request: { headers: forwardedHeaders },
    });
    return addSecurityHeaders(response, request, nonce);
  }

  // 1) Allow public paths through
  if (isPublicPath(pathname, request.method)) {
    const response = NextResponse.next({ request: { headers: forwardedHeaders } });
		return addSecurityHeaders(response, request, nonce);
  }

  // 2) Check session cookie for protected paths
  if (!hasValidSessionCookie(request) && !routeCanValidateBearerToken) {
    // API routes get 401, pages get redirected to login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Not logged in or session expired" },
        { status: 401 },
      );
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return addSecurityHeaders(NextResponse.redirect(loginUrl), request, nonce);
  }

  // 3) CSRF protection for state-changing API requests
  if (
    pathname.startsWith("/api/") &&
    !SAFE_METHODS.has(request.method.toUpperCase())
  ) {
    const csrfCookie = request.cookies.get("csrf_token")?.value;
    const csrfHeader = request.headers.get("x-csrf-token");
    // Skip CSRF only for endpoints that issue the csrf cookie or run
    // pre-session (e.g. the login flow). /api/auth/signout intentionally
    // requires CSRF — the SignOutButton uses csrfFetch() so the header is
    // attached automatically. Removing /api/auth/signout from this list
    // closes a real CSRF surface (any third-party origin could otherwise
    // log a user out via a hidden <form action="/api/auth/signout">).
    if (
      pathname !== "/api/login" &&
      pathname !== "/api/auth/2fa/verify-login" &&
      !routeCanValidateBearerToken
    ) {
      // Constant-time compare — tokens are fixed-length hex from generateCsrfToken().
      if (!csrfCookie || !csrfHeader || !timingSafeEqualString(csrfCookie, csrfHeader)) {
        return NextResponse.json(
          { error: "CSRF token validation failed" },
          { status: 403 },
        );
      }
    }
  }

  // 4) Authenticated — pass through with security headers
  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
	return addSecurityHeaders(response, request, nonce);
}

export const config = {
  // Match all paths except _next/static and _next/image (handled by PUBLIC_PATH_PREFIXES)
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - public folder assets (favicon, etc.)
     */
    "/((?!_next/static|_next/image).*)",
  ],
};
