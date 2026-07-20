/**
 * Typed application errors for VControlHub (TR-041).
 *
 * Replaces unstructured `throw new Error("文案")` so route handlers and
 * `apiCatch` can map error type → HTTP status + machine-readable `code`
 * (TR-034 unified error response shape).
 *
 * Usage:
 *   import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
 *   throw new NotFoundError(t("backend.errors.ts.msg"));                 // 404, code=NOT_FOUND
 *   throw new ValidationError("缺少 id", { field: "id" }); // 400, code=VALIDATION_FAILED
 *
 *   // Or fully custom:
 *   throw new AppError({ code: "QUOTA_EXCEEDED", message: "配额已满", status: 429 });
 *
 * In route handlers, just rely on `apiCatch(e)` — it will detect AppError
 * subclasses and produce the right status + code automatically.
 */

import type { ApiErrorCode } from "@/lib/http/api-error-codes";
import { t } from "@/lib/i18n/translations";

export type AppErrorOptions = {
	code: ApiErrorCode;
	message: string;
	status: number;
	details?: unknown;
	/** Optional underlying cause (preserved for logging) */
	cause?: unknown;
};

/**
 * Base typed error. Carries `code` (machine-readable), `status` (HTTP),
 * and optional `details` payload (validation field errors, etc.).
 */
export class AppError extends Error {
	readonly code: ApiErrorCode;
	readonly status: number;
	readonly details?: unknown;
	readonly cause?: unknown;

	constructor(options: AppErrorOptions) {
		super(options.message);
		this.name = "AppError";
		this.code = options.code;
		this.status = options.status;
		this.details = options.details;
		this.cause = options.cause;
	}
}

/** 401 — caller is not authenticated. */
export class AuthError extends AppError {
	constructor(message = "Authentication required", details?: unknown) {
		super({ code: "AUTH_REQUIRED", message, status: 401, details });
		this.name = "AuthError";
	}
}

/** 403 — authenticated but lacking permission. */
export class ForbiddenError extends AppError {
	constructor(message = "Access forbidden", details?: unknown) {
		super({ code: "FORBIDDEN", message, status: 403, details });
		this.name = "ForbiddenError";
	}
}

/** 404 — resource not found. */
export class NotFoundError extends AppError {
	constructor(message = "Resource not found", details?: unknown) {
		super({ code: "NOT_FOUND", message, status: 404, details });
		this.name = "NotFoundError";
	}
}

/** 400 — input did not pass validation. `details` typically carries field errors. */
export class ValidationError extends AppError {
	constructor(message = "Validation failed", details?: unknown) {
		super({ code: "VALIDATION_FAILED", message, status: 400, details });
		this.name = "ValidationError";
	}
}

/** 409 — request conflicts with current state (duplicate slug, version race, etc.). */
export class ConflictError extends AppError {
	constructor(message = "Conflict", details?: unknown) {
		super({ code: "CONFLICT", message, status: 409, details });
		this.name = "ConflictError";
	}
}

/** 429 — caller exceeded rate limit. */
export class RateLimitError extends AppError {
	constructor(message = "Rate limit exceeded", details?: unknown) {
		super({ code: "RATE_LIMITED", message, status: 429, details });
		this.name = "RateLimitError";
	}
}

/**
 * 422 (default) — business rule rejected the operation.
 *
 * Use when the request is well-formed but cannot proceed: e.g. "存储节点离线
 * 不能写入"、"备份策略已禁用"。 Distinguish from 400 (malformed input) and
 * 409 (concurrent state mismatch).
 */
export class BusinessError extends AppError {
	constructor(message: string, details?: unknown, status = 422) {
		super({ code: "BUSINESS_RULE_FAILED", message, status, details });
		this.name = "BusinessError";
	}
}

/** Type guard. */
export function isAppError(value: unknown): value is AppError {
	return value instanceof AppError;
}
