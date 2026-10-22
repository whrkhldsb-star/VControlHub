/**
 * Localized summaries for raw system errors that surface in the UI.
 *
 * Storage sync / file listing surfaces Node fs errors verbatim
 * ("Scanning E:\… failed: ENOENT: …"), which reads as English stack noise.
 * Node error codes (ENOENT, EACCES, ECONNREFUSED, …) are locale-independent,
 * so matching on them is stable across OS languages. The raw message stays
 * available as `detail` for ops diagnosis — only the headline is localized.
 */
export type KnownErrorCopy = {
	/** Localized one-line summary for the notice headline. */
	summary: string;
	/** The original raw message, kept for diagnosis. */
	detail: string;
};

type TFn = (key: string) => string;

// The error code decides; an operation name does not. "EACCES: permission
// denied, scandir …" names the operation too, and a rule matching "scandir"
// ahead of the code called a folder that exists but cannot be read missing.
const RULES: ReadonlyArray<{ pattern: RegExp; summaryKey: string }> = [
	{ pattern: /\bEACCES\b|\bEPERM\b|permission denied/i, summaryKey: "commonError.accessDenied" },
	{ pattern: /\bENOENT\b|no such file or directory/i, summaryKey: "commonError.pathMissing" },
	{ pattern: /\bECONNREFUSED\b/i, summaryKey: "commonError.connectionRefused" },
	{ pattern: /\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|\btimeout\b/i, summaryKey: "commonError.timeout" },
	{ pattern: /\bECONNRESET\b|socket hang up|\baborted\b/i, summaryKey: "commonError.connectionReset" },
	// A directory scan that failed without a code.
	{ pattern: /scandir/i, summaryKey: "commonError.pathMissing" },
];

/** Map a raw error string to a localized summary; never throws, never empty. */
export function describeKnownError(raw: string, t: TFn): KnownErrorCopy {
	const trimmed = raw.trim();
	const rule = RULES.find(({ pattern }) => pattern.test(trimmed));
	return { summary: rule ? t(rule.summaryKey) : t("commonError.generic"), detail: collapseAbsolutePaths(trimmed) };
}

/**
 * Absolute filesystem paths in a raw message (`scandir '/srv/storage/teams/x'`)
 * describe the host, not the user's folder: keep only the last segment so the
 * notice still names what failed without mapping the server's directory layout.
 */
export function collapseAbsolutePaths(message: string): string {
	return message.replace(/(?<![\w.:/])\/(?:[^\s'"`,;:()]+\/)+([^\s'"`,;:()]+)/g, "…/$1");
}
