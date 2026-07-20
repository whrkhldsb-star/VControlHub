/**
 * Unified API error response (TR-034) — emits `{ code, message, details? }`.
 *
 * Backwards compatible with the legacy `apiError(status, message)` signature
 * so existing call sites keep working while new code can opt into structured
 * errors via the object form or by throwing typed `AppError` subclasses
 * (see `lib/errors.ts`, TR-041).
 *
 * Recommended usage in route handlers:
 *
 *   import { apiCatch } from "@/lib/http/api-error";
 *   import { ValidationError, NotFoundError } from "@/lib/errors";
 *
 *   try {
 *     const parsed = schema.safeParse(input);
 *     if (!parsed.success) {
 *       throw new ValidationError("输入校验失败", parsed.error.flatten().fieldErrors);
 *     }
 *     const item = await getItem(id);
 *     if (!item) throw new NotFoundError("条目不存在");
 *     return NextResponse.json(item);
 *   } catch (e) {
 *     return apiCatch(e);
 *   }
 *
 * Direct construction is also supported:
 *
 *   return apiError({ code: "INVALID_PORT", message: "端口非法", status: 400 });
 *   return apiError(403, "无权访问");                // legacy form, code=GENERIC_ERROR
 */

import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logging";
import { isAppError } from "@/lib/errors";
import { type ApiErrorCode } from "@/lib/http/api-error-codes";

const logger = createLogger("api");

/** Wire format for every error response served by API routes (TR-034). */
export type ApiErrorBody = {
	code: ApiErrorCode;
	message: string;
	details?: unknown;
	/** Legacy `error` mirror — kept until all clients migrate to `message`. */
	error: string;
};

export type ApiErrorOptions = {
	code: ApiErrorCode;
	message: string;
	status: number;
	details?: unknown;
};

function buildBody(opts: ApiErrorOptions): ApiErrorBody {
	const body: ApiErrorBody = {
		code: opts.code,
		message: opts.message,
		// Mirror `message` into the legacy `error` field so existing front-end
		// code that reads `body.error` keeps working through the migration.
		error: opts.message,
	};
	if (opts.details !== undefined) body.details = opts.details;
	return body;
}

/**
 * Return a standardized JSON error response.
 *
 * Three accepted forms:
 *   apiError({ code, message, status, details? })   // structured (preferred)
 *   apiError(status, message)                       // legacy (auto code=GENERIC_ERROR)
 *   apiError(status, message, code)                 // legacy with explicit code
 */
export function apiError(options: ApiErrorOptions): NextResponse;
export function apiError(status: number, message: string, code?: ApiErrorCode): NextResponse;
export function apiError(
	a: ApiErrorOptions | number,
	b?: string,
	c?: ApiErrorCode,
): NextResponse {
	let opts: ApiErrorOptions;
	if (typeof a === "number") {
		opts = {
			code: c ?? "GENERIC_ERROR",
			message: b ?? "Request failed",
			status: a,
		};
	} else {
		opts = a;
	}
	return NextResponse.json(buildBody(opts), { status: opts.status });
}

/**
 * Catch handler for API routes. Recognises three shapes:
 *
 *   - `AppError` subclasses (lib/errors.ts) → use their `code`, `status`, `details`.
 *   - Plain `Error` / unknown                → fall back to `fallbackStatus` + `fallbackMessage`.
 *
 * 5xx responses are logged. 4xx responses are not (avoid log spam from user input).
 */
export function apiCatch(
	e: unknown,
	fallbackStatus = 500,
	fallbackMessage = "Operation failed",
): NextResponse {
	let opts: ApiErrorOptions;

	if (isAppError(e)) {
		opts = {
			code: e.code,
			// AppError messages are intentional product copy; keep them.
			message: e.message,
			status: e.status,
			details: e.details,
		};
	} else if (e instanceof Error) {
		// Never leak raw internal exception text on 5xx to clients.
		const isServerError = fallbackStatus >= 500;
		opts = {
			code: isServerError ? "INTERNAL_ERROR" : "GENERIC_ERROR",
			message: isServerError ? fallbackMessage : e.message || fallbackMessage,
			status: fallbackStatus,
		};
	} else {
		opts = {
			code: "INTERNAL_ERROR",
			message: fallbackMessage,
			status: fallbackStatus,
		};
	}

	if (opts.status >= 500) {
		logger.error(opts.message, e);
	}

	return NextResponse.json(buildBody(opts), { status: opts.status });
}
