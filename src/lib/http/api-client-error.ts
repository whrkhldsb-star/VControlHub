/**
 * Client-side API error thrown by csrfFetch / api-client for non-2xx responses.
 * Carries TR-034 envelope fields (code, category, details) for front-end dispatch.
 */

import {
	categoryForCode,
	isApiErrorCode,
	toApiErrorCode,
	type ApiErrorCategory,
	type ApiErrorCode,
} from "@/lib/http/api-error-codes";

/**
 * Thrown by the client for every non-2xx response. The original response body
 * is preserved on `body` (typed loosely to support both the new
 * `{ code, message, error, details? }` envelope and any legacy body shape),
 * but the canonical `code`, `category`, and `message` fields are surfaced
 * for ergonomic dispatch in the front-end.
 */
export class ApiError extends Error {
	readonly status: number;
	readonly code: ApiErrorCode;
	readonly category: ApiErrorCategory;
	readonly body: Record<string, unknown>;
	readonly details?: unknown;

	constructor(status: number, body: Record<string, unknown>) {
		// Prefer the canonical `message` field (TR-034 envelope), fall back to
		// the legacy `error` mirror, fall back to statusText.
		const rawMessage =
			(typeof body.message === "string" && body.message) ||
			(typeof body.error === "string" && body.error) ||
			`API Error ${status}`;
		super(rawMessage);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
		this.code = isApiErrorCode(body.code) ? body.code : toApiErrorCode(body.code);
		this.category = categoryForCode(this.code);
		// Pass `details` through when present; otherwise drop it to avoid
		// leaking server-internal noise into the UI.
		this.details = body.details !== undefined ? body.details : undefined;
	}
}
