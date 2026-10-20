import { prisma } from "@/lib/db";

export type ServerDeletionImpact = {
  storageNodes: number;
  files: number;
  fileVersions: number;
  shares: number;
  mediaItems: number;
  scheduledTasks: number;
  alertRules: number;
  playbooks: number;
  syncJobs: number;
  quickServices: number;
  backupSchedules: number;
  backupRecords: number;
  /**
   * Work still running against the server. Its rows go with the server by
   * cascade: a running command lost its targets (the remote process went on
   * with nowhere to report) and a running download its task (aria2 kept
   * fetching). Moving the server is refused for the same reason.
   */
  unfinishedCommands: number;
  unfinishedDownloads: number;
};

function jsonReferencesServer(value: unknown, serverId: string): boolean {
  if (Array.isArray(value)) return value.some((item) => jsonReferencesServer(item, serverId));
  if (!value || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === "serverId" && nested === serverId) return true;
    if (key === "serverIds" && Array.isArray(nested) && nested.includes(serverId)) return true;
    if (jsonReferencesServer(nested, serverId)) return true;
  }
  return false;
}

export async function getServerDeletionImpact(serverId: string): Promise<ServerDeletionImpact> {
  const storageNodes = await prisma.storageNode.findMany({
    where: { serverId },
    select: { id: true },
  });
  const storageNodeIds = storageNodes.map((node) => node.id);
  const storageScope = storageNodeIds.length > 0 ? { storageNodeId: { in: storageNodeIds } } : null;

  const [
    files,
    fileVersions,
    shares,
    mediaItems,
    scheduledTasks,
    alertRules,
    playbooks,
    syncJobs,
    quickServices,
    backupSchedules,
    backupRecords,
    unfinishedCommands,
    unfinishedDownloads,
  ] = await Promise.all([
    storageScope ? prisma.fileEntry.count({ where: storageScope }) : 0,
    storageScope ? prisma.fileVersion.count({ where: storageScope }) : 0,
    storageScope ? prisma.shareLink.count({ where: storageScope }) : 0,
    storageScope ? prisma.mediaItem.count({ where: storageScope }) : 0,
    prisma.scheduledTask.count({ where: { serverIds: { has: serverId } } }),
    prisma.alertRule.count({ where: { serverIds: { has: serverId } } }),
    prisma.playbook.findMany({ select: { steps: true } }),
    prisma.syncJob.count({
      where: { OR: [{ sourceServerId: serverId }, { targetServerId: serverId }] },
    }),
    prisma.quickService.count({ where: { serverId } }),
    prisma.vpsBackupSchedule.count({ where: { serverId } }),
    prisma.vpsBackupRecord.count({ where: { serverId } }),
    prisma.commandTarget.count({ where: { serverId, status: { in: ["PENDING_APPROVAL", "APPROVED", "RUNNING", "CANCELLING"] } } }),
    prisma.downloadTask.count({ where: { serverId, status: { in: ["PENDING", "RUNNING"] } } }),
  ]);

  return {
    storageNodes: storageNodes.length,
    files,
    fileVersions,
    shares,
    mediaItems,
    scheduledTasks,
    alertRules,
    playbooks: playbooks.filter((playbook) => jsonReferencesServer(playbook.steps, serverId)).length,
    syncJobs,
    quickServices,
    backupSchedules,
    backupRecords,
    unfinishedCommands,
    unfinishedDownloads,
  };
}

export function getBlockingServerDeletionImpact(impact: ServerDeletionImpact) {
  return Object.entries(impact).filter(
    ([key, count]) => key !== "storageNodes" && count > 0,
  ) as Array<[Exclude<keyof ServerDeletionImpact, "storageNodes">, number]>;
}
