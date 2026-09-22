/**
 * POSIX shell single-quoting — the one implementation every command builder
 * in the codebase must use. Local copies have historically drifted between
 * escaping idioms; importing from here keeps shell-injection protection in
 * one audited place.
 *
 * Wraps the value in single quotes and ends/re-opens the quote around any
 * embedded single quote (`'` → `'\''`), which is safe for bash/sh argv built
 * for local *and* remote (SSH) POSIX targets. Numbers are stringified so
 * callers can pass ports/ids directly.
 */
export function shellQuote(value: string | number): string {
	return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
