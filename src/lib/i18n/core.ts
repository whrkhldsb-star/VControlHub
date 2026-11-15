export type Locale = "zh" | "en";

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** "{count|item|items}": one of two forms, chosen by the number given for `count`. */
const PLURAL_FORM = /\{(\w+)\|([^{}|]*)\|([^{}|]*)\}/g;

/**
 * Fill a sentence's placeholders. A plural form "{count|item|items}" takes its first form when the number given
 * for `count` is 1 and its second otherwise: English needs it ("1 items" without it); Chinese has no plural and
 * does not use it. A form whose number is not given stays as it is, like a placeholder.
 */
export function interpolate(
	text: string,
	vars?: Record<string, string | number>,
): string {
	if (!vars) return text;
	let output = text.includes("|")
		? text.replace(PLURAL_FORM, (form, name: string, one: string, other: string) =>
			Object.prototype.hasOwnProperty.call(vars, name) ? (Number(vars[name]) === 1 ? one : other) : form)
		: text;
	for (const [key, value] of Object.entries(vars)) {
		output = output.split(`{${key}}`).join(String(value));
	}
	return output;
}
