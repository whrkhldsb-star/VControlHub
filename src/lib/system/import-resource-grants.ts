import { ValidationError } from "@/lib/errors";
import type { ExportFile, ImportOptions, ImportIssue } from "./config-schema";
import type { Tx } from "./import-executors-helpers";
import { canImportResourceGrant, loadImportReferences, type GrantUser, type TeamOwner } from "./import-reference-scope";
import { planUniqueImport } from "./import-unique-rows";

type Tables = ExportFile["tables"];
type ServerGrant = Tables["userServerAccess"][number];
type StorageGrant = Tables["userStorageAccess"][number];

const serverGrantKey = (row: Pick<ServerGrant, "userId" | "serverId">) => JSON.stringify([row.userId, row.serverId]);
const storageGrantKey = (row: Pick<StorageGrant, "userId" | "storageNodeId" | "pathPrefix">) =>
  JSON.stringify([row.userId, row.storageNodeId, row.pathPrefix]);

export function loadServerGrants(db: Pick<Tx, "userServerAccess">, records: ServerGrant[]) {
  return loadImportReferences(records.map((row) => row.userId), (ids) => db.userServerAccess.findMany({
    where: { userId: { in: ids } }, select: { userId: true, serverId: true },
  }));
}

export async function loadStorageGrants(db: Pick<Tx, "userStorageAccess">, records: StorageGrant[]) {
  const select = { id: true, userId: true, storageNodeId: true, pathPrefix: true, storageNode: { select: { teamId: true } },
    user: { select: { teamMembership: { select: { teamId: true } } } } } as const;
  const [byId, byPath] = await Promise.all([
    loadImportReferences(records.map((row) => row.id), (ids) => db.userStorageAccess.findMany({ where: { id: { in: ids } }, select })),
    loadImportReferences(records, (rows) => db.userStorageAccess.findMany({ where: {
      OR: rows.map(({ userId, storageNodeId, pathPrefix }) => ({ userId, storageNodeId, pathPrefix })),
    }, select })),
  ]);
  return [...byId, ...byPath];
}

export function planServerGrantImport(
  records: ServerGrant[],
  existing: Array<Pick<ServerGrant, "userId" | "serverId">>,
  options: ImportOptions,
  users: ReadonlyMap<string, GrantUser>,
  servers: ReadonlyMap<string, TeamOwner>,
) {
  const present = new Set(existing.map(serverGrantKey));
  const seen = new Set<string>();
  const plan: Array<{ row: ServerGrant; action: "create" | "update" }> = [];
  for (const row of records) {
    if (!canImportResourceGrant(users.get(row.userId), servers.get(row.serverId))) continue;
    const key = serverGrantKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    if (present.has(key)) {
      if (options.overwriteExisting) plan.push({ row, action: "update" });
    } else {
      plan.push({ row, action: "create" });
    }
  }
  return plan;
}

export function planStorageGrantImport(
  records: StorageGrant[],
  existing: Awaited<ReturnType<typeof loadStorageGrants>>,
  options: ImportOptions,
  users: ReadonlyMap<string, GrantUser>,
  nodes: ReadonlyMap<string, TeamOwner>,
  issues?: ImportIssue[],
) {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const valid = records.filter((row) => {
    const node = nodes.get(row.storageNodeId);
    const user = users.get(row.userId);
    if (!canImportResourceGrant(user, node)) return false;
    const old = byId.get(row.id);
    if (options.overwriteExisting && old && ((old.userId !== row.userId && (old.user.teamMembership?.teamId ?? null) !== user?.teamId)
      || (old.storageNodeId !== row.storageNodeId && old.storageNode.teamId !== node?.teamId))) {
      if (!issues) throw new ValidationError("IMPORT_GRANT_OWNER");
      issues.push({ table: "storageAccess", id: row.id, blocking: true, reason: "nav.customerLabel" });
      return false;
    }
    return true;
  });
  return planUniqueImport(valid, existing.map((row) => ({ id: row.id, key: storageGrantKey(row) })), storageGrantKey, options.overwriteExisting, true);
}
