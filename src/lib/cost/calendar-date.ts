/**
 * Whether `YYYY-MM-DD` names a real calendar day. `Date` silently rolls an
 * impossible day over (2026-02-31 becomes 2026-03-03), which booked a
 * February bill in March; reading the parts back catches that.
 */
export function isCalendarDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
	if (!match) return false;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
