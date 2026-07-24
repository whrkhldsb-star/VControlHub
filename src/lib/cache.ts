/**
 * API response caching utilities.
 * Adds Cache-Control headers with stale-while-revalidate for GET endpoints.
 */

export interface CacheOptions {
	/** Max time the response is considered fresh (seconds) */
	maxAge?: number;
	/** Allow serving stale content while revalidating (seconds) */
	staleWhileRevalidate?: number;
	/** Who can cache this response: "public" or "private" (default: "private") */
	visibility?: "public" | "private";
	/** Whether to add ETag header support (handled by caller) */
	etag?: string;
}

const DEFAULT_OPTIONS: Required<CacheOptions> = {
	maxAge: 0,
	staleWhileRevalidate: 0,
	visibility: "private",
	etag: "",
};

/**
 * Build a Cache-Control header value from options.
 *
 * When both maxAge and staleWhileRevalidate are 0, emit `no-store` so the
 * response cannot be stored by browsers/intermediaries (matches streaming
 * routes that hardcode `private, no-store`). `no-cache` alone only forces
 * revalidation and still allows storage.
 */
export function buildCacheControl(opts: CacheOptions = {}): string {
	const { maxAge, staleWhileRevalidate, visibility } = { ...DEFAULT_OPTIONS, ...opts };

	const parts: string[] = [visibility];

	if (maxAge > 0) {
		parts.push(`max-age=${maxAge}`);
	} else if (staleWhileRevalidate <= 0) {
		parts.push("no-store");
	} else {
		parts.push("no-cache");
	}

	if (staleWhileRevalidate > 0) {
		parts.push(`stale-while-revalidate=${staleWhileRevalidate}`);
	}

	return parts.join(", ");
}

/**
 * Add caching headers to a Response.
 * Usage: return withCacheHeaders(response, { maxAge: 60, staleWhileRevalidate: 120 })
 */
export function withCacheHeaders(response: Response, opts: CacheOptions = {}): Response {
	response.headers.set("Cache-Control", buildCacheControl(opts));
	if (opts.etag) {
		response.headers.set("ETag", opts.etag);
	}
	return response;
}

/**
 * Common cache presets for API routes.
 */
export const CachePresets = {
	/** No caching at all — always revalidate */
	noStore: { maxAge: 0, staleWhileRevalidate: 0, visibility: "private" as const },
	/** Short cache: 30s fresh, 60s stale-while-revalidate */
	shortLived: { maxAge: 30, staleWhileRevalidate: 60, visibility: "private" as const },
	/** Medium cache: 60s fresh, 120s stale-while-revalidate */
	mediumLived: { maxAge: 60, staleWhileRevalidate: 120, visibility: "private" as const },
	/** Long cache for public data: 300s fresh, 600s stale-while-revalidate */
	longLivedPublic: { maxAge: 300, staleWhileRevalidate: 600, visibility: "public" as const },
	/** Image files: 1 hour fresh, 1 day stale */
	imageFile: { maxAge: 3600, staleWhileRevalidate: 86400, visibility: "public" as const },
};
