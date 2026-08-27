/**
 * Shared renderer for an audit log's `detail` JSON.
 *
 * `String(value)` collapses every nested object to "[object Object]", and audit
 * details routinely nest — `ai.ops.settings.update` records `{ mode: { from, to } }`,
 * other writers pass metric readings, playbook step lists or zod issues. Both the
 * audit table and the CSV export need the real values, so both come through here.
 */

/** One `key=value` fragment per detail field, nested values serialised as JSON. */
export function auditDetailEntries(
	detail: Record<string, unknown> | null | undefined,
): string[] {
	if (!detail) return [];
	return Object.entries(detail).map(
		([key, value]) => `${key}=${formatAuditDetailValue(value)}`,
	);
}

/** Scalars as-is; objects and arrays as compact JSON. */
export function formatAuditDetailValue(value: unknown): string {
	if (value === null || value === undefined) return String(value);
	if (typeof value !== "object") return String(value);
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		// A circular structure cannot come back from the database, but a caller may
		// hand one straight to the formatter.
		return String(value);
	}
}

/** The whole detail object on one line. */
export function formatAuditDetail(
	detail: Record<string, unknown> | null | undefined,
	separator = ", ",
): string {
	return auditDetailEntries(detail).join(separator);
}
