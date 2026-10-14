/**
 * Shared pieces of the anonymous status board API routes.
 *
 * Responses are `no-store`: revocation must not linger in browser or proxy
 * caches, and the server keeps its own short in-process cache of finished
 * public DTOs instead. A closed board, an unpublished/hidden node and an
 * unknown id all answer the same 404.
 */
import { NextResponse } from "next/server";

import { apiCopy } from "@/lib/i18n/api-copy";
import { apiError } from "@/lib/http/api-error";
import type { RateLimitConfig } from "@/lib/http/rate-limit-presets";
import { getApiSession } from "@/lib/auth/api-session";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";

/** One bucket for every public status endpoint, per client address. */
export const PUBLIC_STATUS_RATE_LIMIT: RateLimitConfig = { maxRequests: 240, windowMs: 60_000, bucketKey: "public-status" };

export function publicJson(body: unknown): NextResponse {
	const response = NextResponse.json(body);
	response.headers.set("Cache-Control", "no-store");
	return response;
}

export function publicNotFound(): NextResponse {
	const response = apiError({ code: "NOT_FOUND", message: apiCopy("apiCopy.publicStatus.notFound"), status: 404 });
	response.headers.set("Cache-Control", "no-store");
	return response;
}

/**
 * `?preview=1` lets a platform administrator read a closed board through the
 * very same projection. For anyone else the parameter is ignored.
 */
export async function previewAllowed(request: Request): Promise<boolean> {
	let wanted = false;
	try {
		wanted = new URL(request.url).searchParams.get("preview") === "1";
	} catch {
		wanted = false;
	}
	if (!wanted) return false;
	const session = await getApiSession();
	return Boolean(session && isGlobalTeamManager(session));
}
