const NUL = "\u0000";
const REPLACEMENT = "�";
const MAX_DEPTH = 24;

/**
 * Replace U+0000, which PostgreSQL `text` and `jsonb` refuse to store. Output of a remote command is
 * arbitrary bytes (`cat /proc/1/environ`, `tar c` aimed at stdout), and one NUL turned a command that
 * succeeded into a failed write.
 */
export function stripNul(value: string): string {
  return value.includes(NUL) ? value.replaceAll(NUL, REPLACEMENT) : value;
}

/** `stripNul` over every string (and object key) of a JSON-like value; the value itself when nothing changed. */
export function stripNulDeep<T>(value: T, depth = 0): T {
  if (typeof value === "string") return stripNul(value) as T;
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const cleaned = stripNulDeep(item, depth + 1);
      if (cleaned !== item) changed = true;
      return cleaned;
    });
    return (changed ? next : value) as T;
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const cleanKey = stripNul(key);
    const cleaned = stripNulDeep(item, depth + 1);
    if (cleanKey !== key || cleaned !== item) changed = true;
    next[cleanKey] = cleaned;
  }
  return (changed ? next : value) as T;
}

/** Whether a parsed JSON value holds U+0000 in a string or an object key. */
export function containsNul(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (current.includes(NUL)) return true;
    } else if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current !== null && typeof current === "object") {
      for (const [key, item] of Object.entries(current)) {
        if (key.includes(NUL)) return true;
        pending.push(item);
      }
    }
  }
  return false;
}
