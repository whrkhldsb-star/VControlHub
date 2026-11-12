/**
 * Convenience rate-limit presets for API routes.
 *
 * Routes normally name a preset in `withApiRoute({ rateLimit: UPLOAD_LIMIT, … })`.
 * A handler that cannot use the wrapper checks it directly:
 *   import { rateLimitResponse, withRateLimit, UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
 *
 *   export async function POST(request: Request) {
 *     const limit = await withRateLimit(request, UPLOAD_LIMIT);
 *     if (!limit.allowed) return rateLimitResponse(limit.retryAfterMs);
 *     // ... normal handler logic
 *   }
 */

import { apiCopy } from "@/lib/i18n/api-copy";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

export type RateLimitConfig = {
	maxRequests: number;
	windowMs: number;
	/** Optional stable bucket name. By default each API pathname has its own bucket. */
	bucketKey?: string;
};

/** File uploads: 10 per minute per IP */
export const UPLOAD_LIMIT: RateLimitConfig = { maxRequests: 10, windowMs: 60_000 };

/** Command execution: 5 per minute per IP */
export const COMMAND_LIMIT: RateLimitConfig = { maxRequests: 5, windowMs: 60_000 };

/** General API read: 120 per minute per IP */
export const GENERAL_READ_LIMIT: RateLimitConfig = { maxRequests: 120, windowMs: 60_000 };

/** General API write: 30 per minute per IP */
export const GENERAL_WRITE_LIMIT: RateLimitConfig = { maxRequests: 30, windowMs: 60_000 };

/**
 * Handshake tokens for the SSH/RDP WebSocket gateway (A3-11). Every open tab,
 * reconnect and resumed shell mints one; a workbench with a few tabs riding out
 * a flaky link hit the 30/min general write cap and could no longer reconnect.
 */
export const WS_TOKEN_LIMIT: RateLimitConfig = { maxRequests: 120, windowMs: 60_000 };

/** File favourites, tags and "recently opened" reports: many small writes per browsing session (A4-39). */
export const FILE_PREFERENCE_LIMIT: RateLimitConfig = { maxRequests: 120, windowMs: 60_000 };

/**
 * Chunk PUTs of a resumable upload. Each chunk is up to 5 MiB by default, so
 * GENERAL_WRITE_LIMIT (30/min) capped one user's upload at ~2.5 MiB/s; 240/min
 * sustains ~20 MiB/s while still bounding request floods.
 */
export const UPLOAD_CHUNK_LIMIT: RateLimitConfig = { maxRequests: 240, windowMs: 60_000 };

/** Browser telemetry: allow several samples per navigation, including shared-NAT clients. */
export const WEB_VITALS_WRITE_LIMIT: RateLimitConfig = { maxRequests: 1_000, windowMs: 60_000 };

/** Image upload: 5 per minute per IP */
export const IMAGE_UPLOAD_LIMIT: RateLimitConfig = { maxRequests: 5, windowMs: 60_000 };

/**
 * Host-agent poll: deliberately high, because a legitimate agent's protocol is
 * chatty — 5s idle polls, an immediate re-poll whenever a job is waiting, plus a
 * 20s heartbeat during long commands. This is a floor against anonymous abuse of
 * a public-prefix endpoint (each request costs a token lookup before auth can
 * reject it), not a throttle on real agents.
 */
export const AGENT_POLL_LIMIT: RateLimitConfig = { maxRequests: 240, windowMs: 60_000 };

/**
 * WebDAV: also reachable without a session (the route verifies its own API
 * token, and `/api/webdav/` is exempted from the proxy's bearer checks), so an
 * anonymous caller can force one indexed token lookup per request. The budget is
 * high because a real client is crawl-heavy — one PROPFIND per directory on
 * mount, plus ranged GETs — so this is a ceiling on anonymous abuse, not a
 * throttle on mounted drives.
 */
export const WEBDAV_LIMIT: RateLimitConfig = { maxRequests: 1_200, windowMs: 60_000 };

/**
 * Check rate limit for a request. Returns the result with allowed/retryAfterMs.
 * Uses client IP as the identifier.
 *
 * Each limit of a path keeps its own count. One count per path and address made
 * a path's reads (120/min) use up its writes (30, 10 or 5/min): a list fetched
 * thirty times a minute from one address answered 429 to every change. It also
 * let the limits undo each other, because a check keeps only what its own limit
 * needs — a write cut the shared count down to 31 entries, a short window forgot
 * what a longer one was counting.
 */
export async function withRateLimit(
	request: Request,
	config: RateLimitConfig,
): Promise<{ allowed: boolean; retryAfterMs: number; remaining: number }> {
	const ip = getClientIp(request);
	let pathname = "unknown";
	try {
		pathname = new URL(request.url).pathname;
	} catch {
		// Request.url is expected to be absolute, but keep a stable fallback for tests/adapters.
	}
	// The bucket name stays first: the store caps its keys per namespace, taken from how a key starts.
	const bucket = config.bucketKey?.trim() || pathname;
	return checkRateLimitAsync(`${bucket}:${config.maxRequests}/${config.windowMs}:${ip}`, config);
}

/**
 * Create a 429 response with proper headers and TR-034 error envelope. The
 * message follows the request's language (English outside one): it was an
 * English sentence on every page, and a page shows it as it comes.
 */
export function rateLimitResponse(retryAfterMs: number, message = apiCopy("apiCopy.request.tooManyRequests")): Response {
	return new Response(
		JSON.stringify({
			code: "RATE_LIMITED",
			message,
			// Legacy mirror for clients still reading body.error
			error: message,
		}),
		{
			status: 429,
			headers: {
				"Content-Type": "application/json",
				"Retry-After": String(Math.ceil(retryAfterMs / 1000)),
			},
		},
	);
}
