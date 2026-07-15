/**
 * Tiny className combiner — no external clsx/tailwind-merge dependency.
 * Filters falsy values and flattens one level of arrays.
 *
 * Prefer this over string concatenation when components accept optional
 * className overrides so call sites stay readable:
 *
 *   className={cn("base classes", isActive && "active", className)}
 */
export type ClassValue =
	| string
	| number
	| false
	| null
	| undefined
	| ClassValue[];

export function cn(...values: ClassValue[]): string {
	const out: string[] = [];
	for (const value of values) {
		if (!value && value !== 0) continue;
		if (Array.isArray(value)) {
			const nested = cn(...value);
			if (nested) out.push(nested);
			continue;
		}
		out.push(String(value));
	}
	return out.join(" ");
}
