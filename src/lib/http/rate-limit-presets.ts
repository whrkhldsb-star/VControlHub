/**
 * Convenience rate-limit presets for API routes.
 *
 * Usage in a route handler:
 *   import { withRateLimit, AI_CHAT_LIMIT, UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
 *
 *   export async function POST(request: Request) {
 *     const rateLimitResult = await withRateLimit(request, AI_CHAT_LIMIT);
 *     if (!rateLimitResult.allowed) {
 *       return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, {
 *         status: 429,
 *         headers: { "Retry-After": String(Math.ceil(rateLimitResult.retryAfterMs / 1000)) },
 *       });
 *     }
 *     // ... normal handler logic
 *   }
 */

import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

export type RateLimitConfig = { maxRequests: number; windowMs: number };

/** AI chat: 20 messages per minute per IP */
export const AI_CHAT_LIMIT: RateLimitConfig = { maxRequests: 20, windowMs: 60_000 };

/** File uploads: 10 per minute per IP */
export const UPLOAD_LIMIT: RateLimitConfig = { maxRequests: 10, windowMs: 60_000 };

/** Command execution: 5 per minute per IP */
export const COMMAND_LIMIT: RateLimitConfig = { maxRequests: 5, windowMs: 60_000 };

/** General API write: 30 per minute per IP */
export const GENERAL_WRITE_LIMIT: RateLimitConfig = { maxRequests: 30, windowMs: 60_000 };

/** Image upload: 5 per minute per IP */
export const IMAGE_UPLOAD_LIMIT: RateLimitConfig = { maxRequests: 5, windowMs: 60_000 };

/**
 * Check rate limit for a request. Returns the result with allowed/retryAfterMs.
 * Uses client IP as the identifier.
 */
export async function withRateLimit(
	request: Request,
	config: RateLimitConfig,
): Promise<{ allowed: boolean; retryAfterMs: number; remaining: number }> {
	const ip = getClientIp(request);
	return checkRateLimitAsync(ip, config);
}

/**
 * Create a 429 response with proper headers.
 */
export function rateLimitResponse(retryAfterMs: number, message = "请求过于频繁，请稍后再试"): Response {
	return new Response(JSON.stringify({ error: message }), {
		status: 429,
		headers: {
			"Content-Type": "application/json",
			"Retry-After": String(Math.ceil(retryAfterMs / 1000)),
		},
	});
}
