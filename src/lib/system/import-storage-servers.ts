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
