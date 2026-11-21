type KeyedRow = { id: string; key: string };

/** Plan writes in executor order, including collisions within the package. */
export function planUniqueImport<T extends { id: string }>(
  records: T[],
  existing: KeyedRow[],
  keyOf: (row: T) => string,
  overwriteExisting: boolean,
  updatesFirst = false,
) {
  const keysById = new Map(existing.map(({ id, key }) => [id, key]));
  const ownersByKey = new Map(existing.map(({ id, key }) => [key, id]));
  const seen = new Set<string>();
  records = records.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  const updates = records.filter((row) => keysById.has(row.id));
  const creates = records.filter((row) => !keysById.has(row.id));
  const plan: Array<{ row: T; action: "create" | "update" }> = [];

  function reserve(row: T, action: "create" | "update") {
    const previous = keysById.get(row.id);
    if (action === "create" && previous !== undefined) return;
    const key = keyOf(row);
    const owner = ownersByKey.get(key);
    if (owner !== undefined && owner !== row.id) return;
    if (previous !== undefined) ownersByKey.delete(previous);
    ownersByKey.set(key, row.id);
    keysById.set(row.id, key);
    plan.push({ row, action });
  }

  const planUpdates = () => {
    if (overwriteExisting) for (const row of updates) reserve(row, "update");
  };
  if (updatesFirst) planUpdates();
  for (const row of creates) reserve(row, "create");
  if (!updatesFirst) planUpdates();
  return plan;
}
