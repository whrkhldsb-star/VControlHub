/**
 * Shared CSV cell encoder for report exports.
 *
 * Two things happen here:
 *  1. RFC 4180 quoting — a cell containing a quote, comma, CR or LF is wrapped
 *     in quotes with `"` doubled.
 *  2. Formula-injection neutralisation — Excel, LibreOffice and Sheets execute a
 *     cell that starts with `=`, `+`, `-` or `@` (leading tabs/CRs are skipped
 *     before that check). Our exports carry text supplied by others: share
 *     visitor user agents, file and share names, audit detail values, task
 *     titles and log lines. Such a cell is prefixed with a single quote, which
 *     spreadsheets render as literal text and never evaluate.
 */
export function csvCell(value: unknown): string {
	const text = value == null ? "" : String(value);
	const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
	return /[",\r\n]/.test(guarded)
		? `"${guarded.replaceAll('"', '""')}"`
		: guarded;
}

/** Join one row of already-raw values into a CSV line. */
export function csvRow(values: readonly unknown[]): string {
	return values.map(csvCell).join(",");
}
