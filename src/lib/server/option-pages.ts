/** Collect the complete selector in bounded database pages. The query orders ties by id. */
export async function collectOptionPages<T extends { id: string }>(
  page: (options: { take: number; skip?: number; cursor?: { id: string } }) => Promise<T[]>,
) {
  const rows: T[] = [];
  const size = 200;
  for (;;) {
    const last = rows.at(-1);
    const batch = await page({ take: size, ...(last && { cursor: { id: last.id }, skip: 1 }) });
    rows.push(...batch);
    if (batch.length < size) return rows;
  }
}
