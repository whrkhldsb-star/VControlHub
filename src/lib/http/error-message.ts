/**
 * Shared client/server helper for turning unknown catch values into a
 * user-facing string. Empty Error.message falls back so callers never show a
 * blank toast/banner.
 *
 * A database error is never product copy: its message carries the query
 * ("Invalid `prisma.sshKey.create()` invocation"), models, fields and SQL
 * codes. API routes already hide it (apiCatch); server actions showed it.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
	if (isDatabaseError(error)) return fallback;
	return error instanceof Error && error.message ? error.message : fallback;
}

function isDatabaseError(error: unknown): boolean {
	return error instanceof Error && (error.name.startsWith("PrismaClient") || "clientVersion" in error);
}
