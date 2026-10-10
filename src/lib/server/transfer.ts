/**
 * Moving a server to another customer (platform administrators only).
 *
 * The server keeps its history: its storage node, metrics, quick services and
 * VPS backups move with it. The old customer's own work that points at the
 * server — public shares, image uploads, schedules, alert rules, playbooks,
 * sync jobs, unfinished commands and downloads — must be removed first, so
 * nothing of one customer ends up reaching into another. Per-server and
 * per-storage narrowing rows belong to the old customer's accounts and are
 * dropped.
 */
import type { SessionPayload } from "@/lib/auth/session";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { auditUserAction } from "@/lib/audit/service";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { BusinessError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { getServerDeletionImpact } from "./service-deletion-impact";

/** Old-customer work that would cross customers if the server moved. */
export async function getServerTransferBlockers(serverId: string, storageNodeIds: string[]) {
  const [impact, imageUploads, unfinishedCommands, unfinishedDownloads] = await Promise.all([
    getServerDeletionImpact(serverId),
    storageNodeIds.length ? prisma.imageUpload.count({ where: { storageNodeId: { in: storageNodeIds } } }) : 0,
    prisma.commandTarget.count({ where: { serverId, status: { in: ["PENDING_APPROVAL", "APPROVED", "RUNNING", "CANCELLING"] } } }),
    prisma.downloadTask.count({ where: { serverId, status: { in: ["PENDING", "RUNNING"] } } }),
  ]);
  const blockers = {
    shares: impact.shares,
    imageUploads,
    scheduledTasks: impact.scheduledTasks,
    alertRules: impact.alertRules,
    playbooks: impact.playbooks,
    syncJobs: impact.syncJobs,
    unfinishedCommands,
    unfinishedDownloads,
  };
  return Object.entries(blockers).filter(([, count]) => count > 0) as Array<[keyof typeof blockers, number]>;
}

export async function transferServerToCustomer(serverId: string, targetTeamId: string, session: SessionPayload) {
  if (!isGlobalTeamManager(session)) throw new ForbiddenError(t("backend.customer.platformOnly"));
  const releaseLock = await acquireAdvisoryLock("server-delete", serverId);
  try {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { id: true, name: true, teamId: true, storageNode: { select: { id: true } } },
    });
    if (!server) throw new NotFoundError(t("backend.server.nodeNotFound"));
    if (server.teamId === targetTeamId) throw new ValidationError(t("backend.server.transfer.sameCustomer"));
    const target = await prisma.team.findUnique({ where: { id: targetTeamId }, select: { id: true, name: true, deletedAt: true } });
    if (!target || target.deletedAt) throw new NotFoundError(t("backend.customer.notFound"));

    const storageNodeIds = server.storageNode ? [server.storageNode.id] : [];
    const blockers = await getServerTransferBlockers(serverId, storageNodeIds);
    if (blockers.length > 0) {
      throw new BusinessError(t("backend.server.transfer.blocked", {
        dependencies: blockers.map(([name, count]) => `${t(`backend.server.transfer.blocker.${name}`)} ${count}`).join(", "),
      }));
    }

    await prisma.$transaction([
      prisma.server.update({ where: { id: serverId }, data: { teamId: target.id } }),
      prisma.storageNode.updateMany({ where: { serverId }, data: { teamId: target.id } }),
      prisma.metricSnapshot.updateMany({ where: { serverId }, data: { teamId: target.id } }),
      prisma.userServerAccess.deleteMany({ where: { serverId } }),
      prisma.userStorageAccess.deleteMany({ where: { storageNodeId: { in: storageNodeIds } } }),
      prisma.rdpTicket.deleteMany({ where: { serverId } }),
    ]);
    await auditUserAction(
      session.userId,
      "server.transfer",
      { serverId, name: server.name, fromTeamId: server.teamId, toTeamId: target.id },
      undefined,
      target.id,
    );
    return { serverId, teamId: target.id, teamName: target.name };
  } finally {
    await releaseLock();
  }
}
