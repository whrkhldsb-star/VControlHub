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

const PUBLIC_PATHS_EXACT = new Set(["/login", "/login/verify-2fa", "/api/login", "/api/auth/2fa/verify-login", "/status", "/api/status"]);

const PUBLIC_PATH_PREFIXES = [
	"/_next", // static assets
	"/api/public", // public API endpoints
	"/api/images/", // public image hosting links (auth checked per-record)
	"/favicon.ico",
	"/share/", // share token pages (validated server-side)
];

function isPublicPath(pathname: string): boolean {
	if (PUBLIC_PATHS_EXACT.has(pathname)) return true;
	return PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

// ── Session cookie check ─────────────────────────────────────────
const APP_SLUG = process.env.AUTH_SESSION_COOKIE_NAME?.trim()
	? "" // if custom name is set, we'll read it directly
	: (process.env.NEXT_PUBLIC_APP_SLUG?.trim() || "whrkhldsb");

function getSessionCookieName(): string {
	return process.env.AUTH_SESSION_COOKIE_NAME?.trim() || `${APP_SLUG}_session`;
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
function addSecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
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

	// Content-Security-Policy — development-friendly, production should tighten
	if (process.env.NODE_ENV === "production") {
		headers.set(
			"Content-Security-Policy",
			[
				"default-src 'self'",
				"script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js needs unsafe-inline/eval
				"style-src 'self' 'unsafe-inline'", // Tailwind needs unsafe-inline
				"img-src 'self' data: blob: https://chart.googleapis.com https://api.qrserver.com",
				"font-src 'self' data:",
				"connect-src 'self' ws: wss:", // WebSocket for SSH terminal
				"frame-ancestors 'self'", // equivalent to X-Frame-Options SAMEORIGIN
				"base-uri 'self'",
				"form-action 'self'",
			].join("; "),
		);
	}

	return response;
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

	// 1) Allow public paths through
	if (isPublicPath(pathname)) {
		return addSecurityHeaders(NextResponse.next(), request);
	}

	// 2) Check session cookie for protected paths
	if (!hasValidSessionCookie(request)) {
		// API routes get 401, pages get redirected to login
		if (pathname.startsWith("/api/")) {
			return NextResponse.json(
				{ error: "未登录或会话已过期" },
				{ status: 401 },
			);
		}
		const loginUrl = request.nextUrl.clone();
		loginUrl.pathname = "/login";
		loginUrl.searchParams.set("next", pathname);
		return addSecurityHeaders(NextResponse.redirect(loginUrl), request);
	}

	// 3) CSRF protection for state-changing API requests
	if (pathname.startsWith("/api/") && !SAFE_METHODS.has(request.method.toUpperCase())) {
		const csrfCookie = request.cookies.get("csrf_token")?.value;
		const csrfHeader = request.headers.get("x-csrf-token");
		// Skip CSRF for login endpoint (no session yet)
		if (pathname !== "/api/login" && pathname !== "/api/auth/signout" && pathname !== "/api/auth/2fa/verify-login") {
			if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
				return NextResponse.json(
					{ error: "CSRF token 验证失败" },
					{ status: 403 },
				);
			}
		}
	}

	// 4) Authenticated — pass through with security headers
	return addSecurityHeaders(NextResponse.next(), request);
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
