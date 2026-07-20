/**
 * Constant-time string equality for Edge + Node.
 *
 * Prefer this over `===` when comparing secrets/tokens (CSRF, API tokens, etc.).
 * Length mismatch still short-circuits (token lengths are fixed in our auth paths).
 * Avoids importing `node:crypto` so middleware/proxy can stay Edge-compatible.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
	if (typeof a !== "string" || typeof b !== "string") return false;
	const left = new TextEncoder().encode(a);
	const right = new TextEncoder().encode(b);
	if (left.length !== right.length) return false;
	let diff = 0;
	for (let i = 0; i < left.length; i++) {
		diff |= left[i]! ^ right[i]!;
	}
	return diff === 0;
}
