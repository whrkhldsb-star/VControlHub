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

const RULES: ReadonlyArray<{ pattern: RegExp; summaryKey: string }> = [
	{ pattern: /\bENOENT\b|no such file or directory|scandir/i, summaryKey: "commonError.pathMissing" },
	{ pattern: /\bEACCES\b|\bEPERM\b|permission denied/i, summaryKey: "commonError.accessDenied" },
	{ pattern: /\bECONNREFUSED\b/i, summaryKey: "commonError.connectionRefused" },
	{ pattern: /\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|\btimeout\b/i, summaryKey: "commonError.timeout" },
	{ pattern: /\bECONNRESET\b|socket hang up|\baborted\b/i, summaryKey: "commonError.connectionReset" },
];

/** Map a raw error string to a localized summary; never throws, never empty. */
export function describeKnownError(raw: string, t: TFn): KnownErrorCopy {
	const detail = raw.trim();
	const rule = RULES.find(({ pattern }) => pattern.test(detail));
	return { summary: rule ? t(rule.summaryKey) : t("commonError.generic"), detail };
}
