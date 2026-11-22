import type { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { apiCopy } from "@/lib/i18n/api-copy";
import { containsNul } from "@/lib/text/strip-nul";

const PREFIX = "v1.";

export function encodePageCursor(keys: object) {
  return PREFIX + Buffer.from(JSON.stringify(keys)).toString("base64url");
}

/** A legacy ID can supply its boundary while the scoped source row still exists. */
export async function readPageCursor<T>(
  value: string | undefined, schema: z.ZodType<T>, legacy: (id: string) => Promise<T | null>,
): Promise<T | undefined> {
  if (value === undefined) return undefined;
  if (!value.startsWith(PREFIX)) {
    const row = await legacy(value);
    if (row) return row;
  } else {
    try {
      const keys: unknown = JSON.parse(Buffer.from(value.slice(PREFIX.length), "base64url").toString("utf8"));
      const parsed = schema.safeParse(keys);
      if (parsed.success && !containsNul(keys)) return parsed.data;
    } catch {
      // An unreadable or obsolete cursor is a bad query parameter.
    }
  }
  throw new ValidationError(apiCopy("apiCopy.validation.query.failed"), { field: "cursor" });
}

/** Seek a descending (createdAt, id) listing even if its previous last row was removed. */
export function createdBeforeCursor(cursor: string) {
  const match = /^(\d{1,16})\.(.{1,256})$/.exec(cursor);
  const createdAt = new Date(Number(match?.[1]));
  if (!match || containsNul(cursor) || !Number.isFinite(createdAt.getTime())) return { id: { in: [] } };
  return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: match[2] } }] };
}
