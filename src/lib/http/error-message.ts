import { isForbiddenErrorLike } from "@/lib/errors";

/**
 * Shared client/server helper for turning unknown catch values into a
 * user-facing string. Empty Error.message falls back so callers never show a
 * blank toast/banner.
 *
 * A database error is never product copy: its message carries the query
 * ("Invalid `prisma.sshKey.create()` invocation"), models, fields and SQL
 * codes. API routes already hide it (apiCatch); server actions showed it.
 * Neither is what a production build puts in place of a server error's
 * message (see isServerRedaction).
 */
export function getErrorMessage(error: unknown, fallback: string): string {
	if (isDatabaseError(error) || isServerRedaction(error)) return fallback;
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

/** The sentence in the body of an API refusal: its `message`, else its `error`; "" when it has neither. */
export function refusalSentence(body: unknown): string {
	if (typeof body !== "object" || body === null) return "";
	const { message, error } = body as { message?: unknown; error?: unknown };
	for (const text of [message, error]) {
		if (typeof text === "string" && text.trim()) return text.trim();
	}
	return "";
}

/**
 * The same for a response taken as it comes (a download, a stream): asked for in raw mode, its refusal is not
 * thrown as an ApiError, and callers showed the status alone or the body itself. "" when the body is not an
 * answer of the app — a proxy in front of it, say — so that the caller words it.
 */
export async function readRefusal(response: Response): Promise<string> {
	return refusalSentence(await response.json().catch(() => null));
}

/**
 * What to show when a Server Action called from the browser threw instead of answering, with the `t` of the page:
 *  - nothing when it is the router's signal that the action redirected (the session ran out; the page is already
 *    on its way to the sign-in page, and the signal's own text is "NEXT_REDIRECT");
 *  - the refusal when the permission was taken away while the page was open: that check runs before the action's
 *    own error handling, and a production build keeps only the digest of what was thrown;
 *  - a sentence of ours for what the router throws when the call never reached the action — no answer at all
 *    (the browser's "Failed to fetch"), an action the server no longer has (the page is older than the server,
 *    and the dialog showed `Server Action "40c0…" was not found on the server. Read more: https://nextjs.org/…`),
 *    an answer it could not read (a reverse proxy's error page);
 *  - otherwise the reason when it is one a person can read, else `failed`.
 */
export function thrownActionMessage(error: unknown, t: (key: string) => string, failed: string): string {
	const { name, digest } = error instanceof Error ? (error as Error & { digest?: unknown }) : { name: undefined, digest: undefined };
	if (typeof digest === "string" && digest.startsWith(REDIRECT_SIGNAL)) return "";
	if (isForbiddenErrorLike({ name, digest: typeof digest === "string" ? digest : undefined })) return t("common.noPermission");
	if (error instanceof TypeError) return t("common.networkError");
	if (name === UNRECOGNIZED_ACTION) return t("common.pageOutdated");
	if (error instanceof Error && error.message === UNREADABLE_ANSWER) return t("common.unreadableAnswer");
	return getErrorMessage(error, failed);
}

/** The name of the error next/navigation recognizes with `unstable_isUnrecognizedActionError`. */
const UNRECOGNIZED_ACTION = "UnrecognizedActionError";
/** The router's sentence for an answer that is not a Server Function's; the test holds it against the installed version. */
const UNREADABLE_ANSWER = "An unexpected response was received from the server.";

/** How `redirect()` of next/navigation marks what it throws; the test holds it against the installed version. */
const REDIRECT_SIGNAL = "NEXT_REDIRECT";

/**
 * A plain Error that carries a digest came through the framework: it is what the browser is handed for anything
 * thrown on the server, in a page render or in a Server Action. A production build puts a sentence of React's in
 * place of the message — "Minified React error #441; visit https://react.dev/errors/441 …" in the browser, "An
 * error occurred in the Server Components render. …" while rendering on the server — and keeps only the digest;
 * the real message is in the server log under it. The rename, move, delete and new-folder dialogs showed that
 * sentence. The router's own signals have the same shape, with "NEXT_REDIRECT" for a message.
 *
 * Our own errors keep their names where they are thrown, so a refusal (which carries a digest in order to be
 * recognized after the crossing) still says what it refused.
 */
function isServerRedaction(error: unknown): boolean {
	return error instanceof Error && error.name === "Error" && typeof (error as { digest?: unknown }).digest === "string";
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
