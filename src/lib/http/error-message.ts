/**
 * Shared client/server helper for turning unknown catch values into a
 * user-facing string. Empty Error.message falls back so callers never show a
 * blank toast/banner.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}
