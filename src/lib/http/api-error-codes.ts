/**
 * Machine-readable error codes for every API response (TR-034).
 *
 * Every error response served by a VControlHub route carries a `code` field
 * drawn from {@link ApiErrorCode}. The union is intentionally tight so that
 *   1. TypeScript catches typos in route handlers at compile time
 *   2. Front-end code can `switch (err.code)` exhaustively
 *   3. i18n keys map 1:1 to codes (`apiErrors.AUTH_REQUIRED.title`, etc.)
 *
 * Categories (see {@link categoryForCode}) are used by the front-end to pick
 * the right toast variant without inspecting the HTTP status.
 *
 * Adding a new code: append it to the union AND add it to
 * {@link categoryForCode} below. Everything else flows from those two lists.
 */

// ── Union ─────────────────────────────────────────────────────────
export type ApiErrorCode =
  // 401 — authentication
  | "AUTH_REQUIRED"
  | "AUTH_INVALID_TOKEN"
  | "AUTH_EXPIRED"
  | "PENDING_2FA_EXPIRED"
  | "TWO_FACTOR_DISABLED"
  // 403 — authorization
  | "FORBIDDEN"
  | "PERMISSION_DENIED"
  // 400 — input validation
  | "VALIDATION_FAILED"
  | "INVALID_INPUT"
  | "MISSING_FIELD"
  | "INVALID_PORT"
  | "INVALID_FORMAT"
  | "TWO_FACTOR_INVALID_CODE"
  // 404 — resource not found
  | "NOT_FOUND"
  | "ROUTE_NOT_FOUND"
  // 409 — state conflict
  | "CONFLICT"
  | "DUPLICATE"
  | "VERSION_MISMATCH"
  // 422 — business rule
  | "BUSINESS_RULE_FAILED"
  | "QUOTA_EXCEEDED"
  | "PRECONDITION_FAILED"
  // 429 — rate limit
  | "RATE_LIMITED"
  // 5xx — server errors
  | "INTERNAL_ERROR"
  | "DATABASE_ERROR"
  | "EXTERNAL_SERVICE_ERROR"
  | "TIMEOUT"
  // generic / fallback
  | "GENERIC_ERROR"
  | "METHOD_NOT_ALLOWED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "REQUEST_ENTITY_TOO_LARGE"
  | "BAD_REQUEST";

// ── Runtime helpers ───────────────────────────────────────────────
/** Frozen list of every legal code, for iteration (UI dropdowns, etc.). */
export const ApiErrorCodeValues: ReadonlyArray<ApiErrorCode> = Object.freeze(
  [
    "AUTH_REQUIRED",
    "AUTH_INVALID_TOKEN",
    "AUTH_EXPIRED",
    "PENDING_2FA_EXPIRED",
    "TWO_FACTOR_DISABLED",
    "FORBIDDEN",
    "PERMISSION_DENIED",
    "VALIDATION_FAILED",
    "INVALID_INPUT",
    "MISSING_FIELD",
    "INVALID_PORT",
    "INVALID_FORMAT",
    "TWO_FACTOR_INVALID_CODE",
    "NOT_FOUND",
    "ROUTE_NOT_FOUND",
    "CONFLICT",
    "DUPLICATE",
    "VERSION_MISMATCH",
    "BUSINESS_RULE_FAILED",
    "QUOTA_EXCEEDED",
    "PRECONDITION_FAILED",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
    "DATABASE_ERROR",
    "EXTERNAL_SERVICE_ERROR",
    "TIMEOUT",
    "GENERIC_ERROR",
    "METHOD_NOT_ALLOWED",
    "UNSUPPORTED_MEDIA_TYPE",
    "REQUEST_ENTITY_TOO_LARGE",
    "BAD_REQUEST",
  ] as const,
);

/** Type guard — narrows an arbitrary `unknown` (e.g. a parsed JSON body) to a known code. */
export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && (ApiErrorCodeValues as ReadonlyArray<string>).includes(value);
}

/**
 * Defensive coercion for responses from older clients/routes that may emit
 * unrecognised codes (e.g. legacy `"GENERIC_ERROR"` strings or values from
 * a previous build of the app). Unknown codes collapse to `"GENERIC_ERROR"`.
 */
export function toApiErrorCode(value: unknown): ApiErrorCode {
  return isApiErrorCode(value) ? value : "GENERIC_ERROR";
}

// ── Categorisation (UI hint, NOT a routing decision) ──────────────
export type ApiErrorCategory =
  | "auth"
  | "permission"
  | "validation"
  | "notfound"
  | "conflict"
  | "business"
  | "ratelimit"
  | "server"
  | "unknown";

const CODE_CATEGORY: Readonly<Record<ApiErrorCode, ApiErrorCategory>> = Object.freeze({
  AUTH_REQUIRED: "auth",
  AUTH_INVALID_TOKEN: "auth",
  AUTH_EXPIRED: "auth",
  PENDING_2FA_EXPIRED: "auth",
  TWO_FACTOR_DISABLED: "auth",
  FORBIDDEN: "permission",
  PERMISSION_DENIED: "permission",
  VALIDATION_FAILED: "validation",
  INVALID_INPUT: "validation",
  MISSING_FIELD: "validation",
  INVALID_PORT: "validation",
  INVALID_FORMAT: "validation",
  TWO_FACTOR_INVALID_CODE: "validation",
  NOT_FOUND: "notfound",
  ROUTE_NOT_FOUND: "notfound",
  CONFLICT: "conflict",
  DUPLICATE: "conflict",
  VERSION_MISMATCH: "conflict",
  BUSINESS_RULE_FAILED: "business",
  QUOTA_EXCEEDED: "business",
  PRECONDITION_FAILED: "business",
  RATE_LIMITED: "ratelimit",
  INTERNAL_ERROR: "server",
  DATABASE_ERROR: "server",
  EXTERNAL_SERVICE_ERROR: "server",
  TIMEOUT: "server",
  GENERIC_ERROR: "unknown",
  METHOD_NOT_ALLOWED: "validation",
  UNSUPPORTED_MEDIA_TYPE: "validation",
  REQUEST_ENTITY_TOO_LARGE: "validation",
  BAD_REQUEST: "validation",
});

/**
 * Map a code to its {@link ApiErrorCategory}. Used by the front-end to pick
 * the toast/alert variant and to decide whether to redirect to /login.
 */
export function categoryForCode(code: ApiErrorCode): ApiErrorCategory {
  return CODE_CATEGORY[code];
}
