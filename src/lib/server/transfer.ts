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
import type { Prisma } from "@prisma/client";
import type { SessionPayload } from "@/lib/auth/session";
import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { auditUserAction } from "@/lib/audit/service";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { getServerDeletionImpact, listServerStorageNodes } from "./service-deletion-impact";

/** Old-customer work that would cross customers if the server moved. */
async function getServerTransferBlockers(serverId: string, bindings: Awaited<ReturnType<typeof listServerStorageNodes>>, tx: Prisma.TransactionClient) {
  const storageNodeIds = bindings.map(node => node.id);
  const [impact, imageUploads] = await Promise.all([
    getServerDeletionImpact(serverId, tx, bindings),
    storageNodeIds.length ? tx.imageUpload.count({ where: { storageNodeId: { in: storageNodeIds } } }) : 0,
  ]);
  const { unfinishedCommands, unfinishedDownloads } = impact;
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
  assertPlatformAdmin(session);
  const releaseLock = await acquireAdvisoryLock("server-delete", serverId);
  try {
    const { server, target } = await prisma.$transaction(async (tx) => {
      const server = await tx.server.findUnique({
        where: { id: serverId },
        select: { id: true, name: true, teamId: true },
      });
      if (!server) throw new NotFoundError(t("backend.server.nodeNotFound"));
      if (server.teamId === targetTeamId) throw new ValidationError(t("backend.server.transfer.sameCustomer"));
      const target = await tx.team.findUnique({ where: { id: targetTeamId }, select: { id: true, name: true, deletedAt: true } });
      if (!target || target.deletedAt) throw new NotFoundError(t("backend.customer.notFound"));

      const bindings = await listServerStorageNodes(serverId, tx);
      const storageNodeIds = bindings.map(node => node.id);
      if (bindings.some(node => node.teamId !== server.teamId)) throw new ValidationError(t("backend.fileAgent.binding"));
      const blockers = await getServerTransferBlockers(serverId, bindings, tx);
      if (blockers.length > 0) {
        throw new BusinessError(t("backend.server.transfer.blocked", {
          dependencies: blockers.map(([name, count]) => `${t(`backend.server.transfer.blocker.${name}`)} ${count}`).join(", "),
        }));
      }

      const existingDefault = await tx.storageNode.findFirst({ where: { teamId: target.id, isDefault: true }, select: { id: true } });
      await tx.server.update({ where: { id: serverId }, data: { teamId: target.id } });
      await Promise.all([
        tx.storageNode.updateMany({ where: { id: { in: storageNodeIds } }, data: { teamId: target.id, ...(existingDefault ? { isDefault: false } : {}) } }),
        tx.metricSnapshot.updateMany({ where: { serverId }, data: { teamId: target.id } }),
        tx.userServerAccess.deleteMany({ where: { serverId } }),
        tx.userStorageAccess.deleteMany({ where: { storageNodeId: { in: storageNodeIds } } }),
        tx.rdpTicket.deleteMany({ where: { serverId } }),
        // VPS backup schedules and records run as their creator, who is a member
        // of the old customer: in the new one that account resolves to nobody and
        // every run failed as "owner inactive" (A2-03). The transferring platform
        // administrator takes them over.
        tx.vpsBackupSchedule.updateMany({ where: { serverId }, data: { createdById: session.userId } }),
        tx.vpsBackupRecord.updateMany({ where: { serverId }, data: { createdBy: session.userId } }),
      ]);
      // Changing a drive's team revokes its file credential and removes its former binding.
      // Recreate the association without credentials so the new customer explicitly pairs it.
      const agentBindings = bindings.filter(node => node.driver === "AGENT");
      if (agentBindings.length) {
        await tx.storageNode.updateMany({ where: { id: { in: agentBindings.map(node => node.id) } }, data: {
          healthStatus: "UNKNOWN", lastHealthyAt: null, lastHealthyTransport: null,
          lastHealthCheckAt: null, lastHealthError: null, lastHealthLatencyMs: null,
        } });
        await tx.agentFileShare.createMany({
          data: agentBindings.map(node => ({ storageNodeId: node.id, serverId, teamId: target.id })),
        });
      }
      return { server, target };
    }, { isolationLevel: "Serializable" });
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
