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
    // Pre-filter in SQL: loading every playbook's step JSON into memory to
    // look for one id scanned the whole table per confirmation dialog (A2-12).
    // The exact JSON check below still decides.
    prisma.$queryRaw<Array<{ steps: unknown }>>`SELECT steps FROM playbooks WHERE steps::text LIKE ${`%${serverId.replace(/[\\%_]/g, "\\$&")}%`}`,
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

type BlockingImpact = Exclude<keyof ServerDeletionImpact, "storageNodes">;

export function getBlockingServerDeletionImpact(impact: ServerDeletionImpact) {
  return Object.entries(impact).filter(
    ([key, count]) => key !== "storageNodes" && count > 0,
  ) as Array<[BlockingImpact, number]>;
}

/** The words for each count that blocks a deletion. Typed by the count, so that a new one cannot go without. */
const BLOCKER_COPY: Record<BlockingImpact, string> = {
  files: "backend.server.deletionBlocker.files",
  fileVersions: "backend.server.deletionBlocker.fileVersions",
  shares: "backend.server.deletionBlocker.shares",
  mediaItems: "backend.server.deletionBlocker.mediaItems",
  scheduledTasks: "backend.server.deletionBlocker.scheduledTasks",
  alertRules: "backend.server.deletionBlocker.alertRules",
  playbooks: "backend.server.deletionBlocker.playbooks",
  syncJobs: "backend.server.deletionBlocker.syncJobs",
  quickServices: "backend.server.deletionBlocker.quickServices",
  backupSchedules: "backend.server.deletionBlocker.backupSchedules",
  backupRecords: "backend.server.deletionBlocker.backupRecords",
  unfinishedCommands: "backend.server.deletionBlocker.unfinishedCommands",
  unfinishedDownloads: "backend.server.deletionBlocker.unfinishedDownloads",
};

/**
 * What still refers to the server, for the sentence that refuses to delete it. The refusal listed the fields of
 * the count as they are named here ("files=120, fileVersions=3, unfinishedCommands=2").
 */
export function describeServerDeletionBlockers(
  blockers: ReadonlyArray<readonly [BlockingImpact, number]>,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  return blockers.map(([name, count]) => t(BLOCKER_COPY[name], { count })).join(t("backend.server.deletionBlocker.separator"));
}
