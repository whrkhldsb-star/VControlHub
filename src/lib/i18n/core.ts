export type Locale = "zh" | "en";

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

export function interpolate(
	text: string,
	vars?: Record<string, string | number>,
): string {
	if (!vars) return text;
	let output = text;
	for (const [key, value] of Object.entries(vars)) {
		output = output.split(`{${key}}`).join(String(value));
	}
	return output;
}
