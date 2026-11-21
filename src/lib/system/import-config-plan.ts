import type { ExportFile, ImportOptions } from "./config-schema";
import { isSensitiveSettingKey } from "./config-schema";
import { isValidSettingKey } from "@/lib/settings/service";
import { MASKED_VALUE } from "@/lib/settings/schema";
import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import type { Tx } from "./import-executors-helpers";
import { byId, loadImportReferences } from "./import-reference-scope";
import { planUniqueImport } from "./import-unique-rows";

type Tables = ExportFile["tables"];
type ResolveUsers = (ids: string[]) => Promise<ReadonlySet<string>>;

export class ProviderDefaultBusy extends ConflictError {
  constructor(readonly owner: string) {
    super(t("backend.concurrency.lockBusy"));
  }
}

export function writableSetting(row: Tables["settings"][number], mode?: ExportFile["exportMode"]) {
  return isValidSettingKey(row.key) && (!isSensitiveSettingKey(row.key) ||
    (row.value !== MASKED_VALUE && (row.value !== "" || mode === "full")));
}

export async function planSnippets(db: Pick<Tx, "snippet">, rows: Tables["snippets"], options: ImportOptions, resolveUsers: ResolveUsers) {
  const existing = byId(await loadImportReferences(rows.map((r) => r.id), (ids) =>
    db.snippet.findMany({ where: { id: { in: ids } }, select: { id: true, createdBy: true } })));
  const users = await resolveUsers([...rows, ...existing.values()].flatMap((r) => r.createdBy ? [r.createdBy] : []));
  const valid = rows.flatMap((r) => {
    const previous = existing.get(r.id)?.createdBy;
    const owner = r.createdBy && users.has(r.createdBy) ? r.createdBy
      : r.isPrivate && previous && users.has(previous) ? previous : null;
    return r.isPrivate && !owner ? [] : [{ ...r, createdBy: owner }];
  });
  return planUniqueImport(valid, [...existing.keys()].map((id) => ({ id, key: id })), (r) => r.id, options.overwriteExisting);
}

export async function planAiProviders(db: Pick<Tx, "aiProvider">, rows: Tables["aiProviders"], options: ImportOptions, resolveUsers: ResolveUsers) {
  const select = { id: true, name: true, type: true, baseUrl: true, createdBy: true, apiKey: true, updatedAt: true, isDefault: true } as const;
  const existing = byId(await loadImportReferences(rows.map((r) => r.id), (ids) => db.aiProvider.findMany({ where: { id: { in: ids } }, select })));
  const ownerOf = (r: Tables["aiProviders"][number]) => existing.get(r.id)?.createdBy ?? r.createdBy;
  const users = await resolveUsers(rows.filter((r) => !existing.has(r.id)).map((r) => r.createdBy));
  const valid = rows.filter((r) => existing.has(r.id) || users.has(r.createdBy));
  const peers = await loadImportReferences(valid, (chunk) => db.aiProvider.findMany({
    where: { OR: chunk.map((r) => ({ createdBy: ownerOf(r), OR: [{ name: r.name }, { isDefault: true }] })) },
    select: { id: true, name: true, createdBy: true, isDefault: true },
  }));
  const key = (owner: string, name: string) => JSON.stringify([owner, name]);
  const plan = planUniqueImport(valid, [...existing.values(), ...peers].map((r) => ({ id: r.id, key: key(r.createdBy, r.name) })),
    (r) => key(ownerOf(r), r.name), options.overwriteExisting, true);
  const defaults = new Map<string, string>();
  for (const { row } of plan) if (row.isDefault) defaults.set(ownerOf(row), row.id);
  return { plan, existing, defaults, peers: byId(peers).values(), ownerOf };
}
