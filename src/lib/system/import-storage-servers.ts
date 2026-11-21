import { byId, loadImportReferences } from "./import-reference-scope";
import { planUniqueImport } from "./import-unique-rows";
import type { ExportFile } from "./config-schema";
import type { Tx } from "./import-executors-helpers";

type NodeRow = ExportFile["tables"]["storageNodes"][number];
type ServerProfile = { teamId: string | null; managementMode: string };

export async function loadStorageServers(db: Pick<Tx, "server">, nodes: NodeRow[]) {
  const ids = [...new Set(nodes.flatMap(node => node.serverId ? [node.serverId] : []))];
  const servers = new Map<string, ServerProfile>();
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await db.server.findMany({
      where: { id: { in: ids.slice(i, i + 1000) } },
      select: { id: true, teamId: true, managementMode: true },
    });
    for (const row of rows) servers.set(row.id, row);
  }
  return servers;
}

export function canBindStorageServer(node: NodeRow, server: ServerProfile | undefined): boolean {
  return server !== undefined && server.teamId === (node.teamId ?? null)
    && (node.driver !== "AGENT" || server.managementMode === "AGENT");
}

/** Plan the nullable unique binding using the same fallback as the node write. */
export async function planStorageNodes(db: Pick<Tx, "storageNode">, nodes: NodeRow[], overwrite: boolean, servers: ReadonlyMap<string, ServerProfile>) {
  const existing = byId(await loadImportReferences(nodes, (chunk) => db.storageNode.findMany({
    where: { OR: [
      { id: { in: chunk.map((r) => r.id) } },
      { serverId: { in: chunk.flatMap((r) => r.serverId ? [r.serverId] : []) } },
    ] },
    select: { id: true, teamId: true, serverId: true, server: { select: { teamId: true } } },
  })));
  function binding(row: NodeRow) {
    if (row.driver === "AGENT" || !row.serverId) return null;
    if (canBindStorageServer(row, servers.get(row.serverId))) return row.serverId;
    const old = existing.get(row.id);
    return old?.server && old.server.teamId === (row.teamId ?? null) ? undefined : null;
  }
  const key = (id: string, serverId?: string | null) => JSON.stringify(serverId ? ["server", serverId] : ["node", id]);
  const plan = planUniqueImport(nodes, [...existing.values()].map((r) => ({ id: r.id, key: key(r.id, r.serverId) })), (r) => {
    const next = binding(r);
    return key(r.id, next === undefined ? existing.get(r.id)?.serverId : next);
  }, overwrite);
  return { plan, existing, binding };
}
