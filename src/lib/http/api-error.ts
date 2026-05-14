/**
 * Unified API error handling — reduces boilerplate in route handlers.
 *
 * Usage in API routes:
 *   import { apiError, apiCatch } from "@/lib/http/api-error";
 *
 *   try { ... }
 *   catch (e) { return apiCatch(e); }
 *
 * Or for specific status codes:
 *   return apiError(400, "参数无效");
 */

import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logging";

const logger = createLogger("api");

/** Return a standardized JSON error response */
export function apiError(status: number, message: string): NextResponse {
	return NextResponse.json({ error: message }, { status });
}

/**
 * Catch handler for API routes — extracts message from Error, logs 5xx errors.
 *
 * Usage:
 *   catch (e) { return apiCatch(e); }
 *   // Returns 400 for known errors, 500 for unexpected ones
 *
 *   catch (e) { return apiCatch(e, 404); }
 *   // Returns 404 with the error message
 */
export function apiCatch(e: unknown, fallbackStatus = 400, fallbackMessage = "请求失败"): NextResponse {
	const message = e instanceof Error ? e.message : fallbackMessage;

	// Log server errors (5xx) for debugging
	if (fallbackStatus >= 500) {
		logger.error(message, e);
	}

	return NextResponse.json({ error: message }, { status: fallbackStatus });
}
