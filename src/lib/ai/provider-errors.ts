/** Typed metadata for retry decisions. Raw provider bodies are never persisted here. */
export class AiProviderHttpError extends Error {
	readonly failureKind: "access" | "quota" | "rate_limit" | "upstream" | "request";
	readonly retryAfterMs: number | null;
	constructor(message: string, readonly status: number, body: string, retryAfter: string | null) {
		super(message);
		this.name = "AiProviderHttpError";
		this.failureKind = /insufficient[_\s-]*(quota|balance)|billing|payment.required|credit.*exhaust/i.test(body)
			? "quota" : status === 401 || status === 403 ? "access" : status === 429 ? "rate_limit" : status >= 500 ? "upstream" : "request";
		const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
		const duration = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
		this.retryAfterMs = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 24 * 60 * 60 * 1000) : null;
	}
}
