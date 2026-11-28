/**
 * Shared `{{var}}` variable extraction, substitution, and destination length
 * validation for Snippets, Direct Command Dispatch, Templates, Scheduled Tasks,
 * and Playbooks.
 *
 * Pure, client- and server-safe.
 */

export const MAX_COMMAND_BODY_LENGTH = 10_000;

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_.-]{1,64})\s*\}\}/g;

/** Return distinct `{{var}}` names in first-seen order. */
export function extractSnippetVariables(content: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      ordered.push(name);
    }
  }
  return ordered;
}

/** Replace all `{{var}}` occurrences with the provided values map. */
export function substituteSnippetVariables(
  content: string,
  values: Readonly<Record<string, string>>,
): string {
  return content.replace(VARIABLE_PATTERN, (full, name: string) => {
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      return values[name] ?? "";
    }
    return full;
  });
}

/**
 * Compute the result of inserting `snippetText` at `[selectionStart, selectionEnd]`
 * inside `currentValue`, enforcing `maxLength` without silent truncation.
 */
export function insertSnippetAtSelection(input: {
  currentValue: string;
  snippetText: string;
  selectionStart?: number;
  selectionEnd?: number;
  maxLength?: number;
}): { ok: true; nextValue: string; nextCursor: number } | { ok: false; resultingLength: number; maxLength: number } {
  const maxLength = input.maxLength ?? MAX_COMMAND_BODY_LENGTH;
  const start = Math.max(0, Math.min(input.selectionStart ?? input.currentValue.length, input.currentValue.length));
  const end = Math.max(start, Math.min(input.selectionEnd ?? start, input.currentValue.length));
  const nextValue = input.currentValue.slice(0, start) + input.snippetText + input.currentValue.slice(end);
  if (nextValue.length > maxLength) {
    return { ok: false, resultingLength: nextValue.length, maxLength };
  }
  return { ok: true, nextValue, nextCursor: start + input.snippetText.length };
}
