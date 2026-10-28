/**
 * The provider's model list as the edit form shows it: comma separated.
 *
 * The server keeps it as a JSON array in a text column (`["gpt-4o","gpt-4o-mini"]`) and returns that string as it is.
 * The form took it for a comma list and, on save, split the JSON itself, so every edit (a new name, a new key)
 * stored `["gpt-4o"` and `"gpt-4o-mini"]` as models, and the next edit wrapped them again.
 */
export function modelsForEditing(stored: string): string {
	return parseStoredModels(stored).join(",");
}

/** The ids in a stored list (a JSON array, or a comma list), repaired of the quotes and brackets earlier edits left. */
export function parseStoredModels(stored: string): string[] {
	const text = (stored ?? "").trim();
	if (!text) return [];
	let items: unknown[];
	try {
		const parsed: unknown = JSON.parse(text);
		items = Array.isArray(parsed) ? parsed : text.split(",");
	} catch {
		items = text.split(",");
	}
	return [...new Set(items.map((item) => String(item).replace(/^[\s"'[\\]+|[\s"'\]\\]+$/g, "")).filter(Boolean))];
}
