/** Fields safe to pass to the downloads client for a selected drive. */
export const downloadDriveSelect = {
  id: true, name: true, basePath: true, driver: true, host: true, port: true,
  directAccessMode: true, publicBaseUrl: true, directAccessExpiresSeconds: true,
} as const;

export function selectedDownloadDrive<N extends { id: string }>(
  server: { storageNode: N | null; agentFileShares?: { node: N }[] },
  agentId?: string | null,
) {
  return agentId ? server.agentFileShares?.find(share => share.node.id === agentId)?.node ?? null : server.storageNode;
}

/** Present only this task's drive to existing ACL, listing and transfer code. */
export function resolveTaskDrive<T extends { agentStorageNodeId?: string | null; server: {
  storageNode: { id: string } | null; agentFileShares?: { node: { id: string } }[];
} }>(task: T): T {
  if (!task.server) return task;
  task.server.storageNode = selectedDownloadDrive(task.server, task.agentStorageNodeId);
  delete task.server.agentFileShares;
  return task;
}
