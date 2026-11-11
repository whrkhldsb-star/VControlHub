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
	const refused = schemaIssueMessages(error);
	if (refused !== null) return refused || fallback;
	return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * "<what failed>: <why>" for a toast or a banner; only what failed when the reason is unknown or is not
 * product copy (see getErrorMessage).
 */
export function describeFailure(what: string, error: unknown): string {
	const why = getErrorMessage(error, "");
	return why ? `${what}: ${why}` : what;
}

/**
 * A schema error's own message is the JSON dump of its issues, which is what the server form showed for a host
 * typed as a URL. The issues carry the sentences a person can read. Told apart by shape: this module is shared
 * with the browser, where `instanceof` against another copy of the library would miss.
 */
function schemaIssueMessages(error: unknown): string | null {
	if (!(error instanceof Error) || error.name !== "ZodError") return null;
	const issues: unknown = (error as { issues?: unknown }).issues;
	if (!Array.isArray(issues)) return null;
	const messages = issues
		.map((issue: unknown) => (issue && typeof issue === "object" ? (issue as { message?: unknown }).message : undefined))
		.filter((message): message is string => typeof message === "string" && message.trim() !== "")
		.map((message) => message.trim());
	return [...new Set(messages)].slice(0, 3).join("; ");
}

function isDatabaseError(error: unknown): boolean {
	return error instanceof Error && (error.name.startsWith("PrismaClient") || "clientVersion" in error);
}
