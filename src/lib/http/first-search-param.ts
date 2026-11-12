/**
 * A page's search parameters, one value each.
 *
 * The router hands a parameter that is given more than once (?q=a&q=b — a link edited by hand, two forms merged
 * by a proxy) over as a list, whatever the page declares for its props. Pages that called `.trim()` or `.slice()`
 * on it answered with their error screen, or passed the list on as if it were text. The first value counts, as it
 * does for the files page and in `URLSearchParams.get`.
 */
export function firstSearchParam(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

/** The same for all of a page's parameters at once; absent ones are left out. */
export function firstSearchParams<Key extends string>(
	params: Partial<Record<Key, string | string[]>> | undefined,
): Partial<Record<Key, string>> {
	const first: Partial<Record<Key, string>> = {};
	for (const [key, value] of Object.entries(params ?? {}) as [Key, string | string[] | undefined][]) {
		const one = firstSearchParam(value);
		if (one !== undefined) first[key] = one;
	}
	return first;
}
