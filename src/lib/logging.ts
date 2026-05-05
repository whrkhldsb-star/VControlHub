/**
 * Production-safe logging utilities.
 *
 * In production builds, debug/error logs are stripped to avoid leaking
 * internal details to stdout/stderr. Only explicit warnings that guard
 * against misconfiguration are preserved (and they are gated behind
 * NODE_ENV checks at the call site).
 */

/** Log a debug message — only in development. Stripped in production. */
export function logDebug(..._args: unknown[]): void {
	if (process.env.NODE_ENV !== "production") {
		console.log("[debug]", ..._args);
	}
}

/**
 * Log a non-fatal error — only in development.
 * Use this for catch blocks where the error is already handled
 * (e.g. returning a 500 response). In production the error is
 * silently swallowed since the caller already handles the failure.
 */
export function logError(..._args: unknown[]): void {
	if (process.env.NODE_ENV !== "production") {
		console.error("[error]", ..._args);
	}
}
