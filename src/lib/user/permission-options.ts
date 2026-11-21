import { z } from "zod";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { encodePageCursor, readPageCursor } from "@/lib/http/page-cursor";

export type OptionQuery = { pageSize?: number; after?: string; search?: string; id?: string };
const optionKey = z.object({ id: z.string(), name: z.string(), isBuiltin: z.boolean().optional() });
type OptionKey = z.infer<typeof optionKey>;

export function afterOption(key?: OptionKey) {
  return key ? { OR: [{ name: { gt: key.name } }, { name: key.name, id: { gt: key.id } }] } : {};
}

/** Pickers request one page, while older callers read the same pages to exhaustion. */
export async function readOptionPage<T extends OptionKey>(
  query: OptionQuery,
  fetch: (after: OptionKey | undefined, take: number) => Promise<T[]>,
  legacy: (id: string) => Promise<OptionKey | null>,
) {
  const size = query.pageSize ?? 200;
  const items: T[] = [];
  let after = await readPageCursor(query.after, optionKey, legacy);
  for (;;) {
    const rows = await fetch(after, size + 1);
    items.push(...rows.slice(0, size));
    if (rows.length <= size) return { items, nextCursor: null };
    const { id, name, isBuiltin } = rows[size - 1]!;
    after = { id, name, isBuiltin };
    if (query.pageSize) return { items, nextCursor: encodePageCursor(after) };
  }
}

export function optionFilter({ search, id }: OptionQuery) {
  if (id) return { id };
  return search ? { name: { contains: escapeLikeLiteral(search), mode: "insensitive" as const } } : {};
}
