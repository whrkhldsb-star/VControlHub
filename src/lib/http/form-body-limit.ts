import { NextResponse } from "next/server";

import {
	requestContentLengthExceeds,
	requestContentLengthMissing,
} from "@/lib/http/request-body";

/**
 * Shared pre-parse guard for routes that read `request.formData()` (TR-037).
 *
 * `request.formData()` buffers the whole body in memory before any route code
 * can inspect it, so upload/form routes must reject oversized — and
 * length-undeclared (chunked) — bodies up front. Every route used to inline
 * the same two checks (`requestContentLengthExceeds` → 413,
 * `requestContentLengthMissing` → 411) with its own copy of the JSON body.
 *
 * The rejection copy is supplied by the caller because each route localises it
 * differently (`t(key)`, `t(key, locale)`, `apiCopy(...)`) and the wire format
 * must not change; `build` lets routes that already serve the TR-034 envelope
 * (via `apiError`) keep their exact body shape.
 */
export type FormBodyLimitOptions = {
	/** 413 copy — used when the declared Content-Length exceeds `maxBytes`. */
	tooLargeMessage: string;
	/**
	 * 411 copy — used when the request declares no usable Content-Length.
	 * Defaults to `tooLargeMessage` (most routes reuse the same copy).
	 */
	lengthRequiredMessage?: string;
	/** Extra JSON fields merged into both rejection bodies (e.g. `maxUploadBytes`). */
	fields?: Record<string, unknown>;
	/**
	 * Custom response builder for routes whose 413/411 bodies are not the
	 * plain `{ error }` shape (e.g. sftp upload's `apiError` envelope).
	 */
	build?: (status: 413 | 411, message: string) => Response;
};

function formBodyLimitResponse(
	status: 413 | 411,
	message: string,
	options: FormBodyLimitOptions,
): Response {
	if (options.build) return options.build(status, message);
	return NextResponse.json({ error: message, ...options.fields }, { status });
}

/**
 * Reject a form/multipart body that would be buffered past `maxBytes`.
 *
 * Returns the 413/411 response when the request must be refused, or `null`
 * when parsing may proceed:
 *
 *   const rejected = rejectOversizedFormBody(request, MAX_BYTES, {
 *     tooLargeMessage: t("backend.request.bodyTooLarge"),
 *   });
 *   if (rejected) return rejected;
 *
 * Check order matches the historical inline code: 413 (declared too large)
 * first, then 411 (no declared length).
 */
export function rejectOversizedFormBody(
	request: Request,
	maxBytes: number,
	options: FormBodyLimitOptions,
): Response | null {
	if (requestContentLengthExceeds(request, maxBytes)) {
		return formBodyLimitResponse(413, options.tooLargeMessage, options);
	}
	if (requestContentLengthMissing(request)) {
		return formBodyLimitResponse(
			411,
			options.lengthRequiredMessage ?? options.tooLargeMessage,
			options,
		);
	}
	return null;
}
