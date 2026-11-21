import type { ExportFile, ImportOptions } from "./config-schema";
import type { Tx } from "./import-executors-helpers";
import { hasImportableQuickServiceTarget, loadImportReferences, quickServiceTarget } from "./import-reference-scope";
import { planUniqueImport } from "./import-unique-rows";

type QuickServiceRow = ExportFile["tables"]["quickServices"][number];

const keyOf = (row: { instanceKey?: string; slug: string }) => JSON.stringify([quickServiceTarget(row).instanceKey, row.slug]);

export async function planQuickServiceImport(
  db: Pick<Tx, "quickService">,
  records: QuickServiceRow[],
  options: ImportOptions,
  servers: ReadonlySet<string>,
) {
  const valid = records.filter((row) => hasImportableQuickServiceTarget(row, servers));
  const select = { id: true, instanceKey: true, serverId: true, slug: true } as const;
  const [byId, byTarget] = await Promise.all([
    loadImportReferences(valid.map((row) => row.id), (ids) => db.quickService.findMany({ where: { id: { in: ids } }, select })),
    loadImportReferences(valid, (rows) => db.quickService.findMany({ where: {
      OR: rows.map((row) => ({ instanceKey: quickServiceTarget(row).instanceKey, slug: row.slug })),
    }, select })),
  ]);
  const existing = [...byId, ...byTarget].map((row) => ({ id: row.id, key: keyOf(row) }));
  const previous = new Map(byId.map((row) => [row.id, row]));
  const sameTarget = valid.filter((row) => {
    const current = previous.get(row.id);
    const target = quickServiceTarget(row);
    return !current || (target.instanceKey === current.instanceKey && target.serverId === current.serverId);
  });
  return planUniqueImport(sameTarget, existing, keyOf, options.overwriteExisting);
}
