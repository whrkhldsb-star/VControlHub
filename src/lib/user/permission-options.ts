/** Resource pickers request one page explicitly. Existing consumers that need
 * the complete option list read the same ordered pages to exhaustion. */
export type OptionQuery = { pageSize?: number; after?: string; search?: string; id?: string };

export async function readOptionPage<T extends { id: string }>(
  query: OptionQuery,
  fetch: (after: string | undefined, take: number) => Promise<T[]>,
) {
  const size = query.pageSize ?? 200;
  const items: T[] = [];
  let after = query.after;
  for (;;) {
    const rows = await fetch(after, size + 1);
    items.push(...rows.slice(0, size));
    if (rows.length <= size) return { items, nextCursor: null };
    after = rows[size - 1]!.id;
    if (query.pageSize) return { items, nextCursor: after };
  }
}

export function optionFilter({ search, id }: OptionQuery) {
  if (id) return { id };
  return search ? { name: { contains: search, mode: "insensitive" as const } } : {};
}
