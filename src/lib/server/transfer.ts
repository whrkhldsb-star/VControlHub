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
import { Prisma } from "@prisma/client";
import type { SessionPayload } from "@/lib/auth/session";
import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { auditUserAction } from "@/lib/audit/service";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { appTimeZoneDateKey } from "@/lib/datetime/time-zone";
import { startOfMonthUtc } from "@/lib/cost/service-internals";
import { resetAgentForModeChange } from "./agent-service";
import { firstDirectGatewayKeyVersion, needsLegacyGatewayStop } from "./direct-gateway-key";
import { getServerDeletionImpact, listServerStorageNodes } from "./service-deletion-impact";

/** Old-customer work that would cross customers if the server moved. */
async function getServerTransferBlockers(serverId: string, bindings: Awaited<ReturnType<typeof listServerStorageNodes>>, tx: Prisma.TransactionClient) {
  const storageNodeIds = bindings.map(node => node.id);
  const [impact, imageUploads, fileProxies] = await Promise.all([
    getServerDeletionImpact(serverId, tx, bindings),
    storageNodeIds.length ? tx.imageUpload.count({ where: { storageNodeId: { in: storageNodeIds } } }) : 0,
    tx.serverFileProxy.count({ where: { serverId, OR: [
      { status: { not: "stopped" } },
      // Older stop operations retained credentials even when remote termination failed.
      { pid: { not: null } },
      { accessToken: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    ] } }),
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
    unfinishedAgentJobs: impact.unfinishedAgentJobs,
    fileProxies,
    unfinishedDownloads,
  };
  return Object.entries(blockers).filter(([, count]) => count > 0) as Array<[keyof typeof blockers, number]>;
}

export async function transferServerToCustomer(serverId: string, targetTeamId: string, session: SessionPayload) {
  assertPlatformAdmin(session);
  const releaseLock = await acquireAdvisoryLock("server-delete", serverId);
  try {
    const { server, target } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM servers WHERE id = ${serverId} FOR UPDATE`;
      const server = await tx.server.findUnique({
        where: { id: serverId },
        select: { id: true, name: true, teamId: true, sshKeyId: true, operatingSystem: true, directGatewayKeyVersion: true,
          directGatewayDesiredEnabled: true, fileProxyPort: true, publicUrl: true },
      });
      if (!server) throw new NotFoundError(t("backend.server.nodeNotFound"));
      if (server.teamId === targetTeamId) throw new ValidationError(t("backend.server.transfer.sameCustomer"));
      const target = await tx.team.findUnique({ where: { id: targetTeamId }, select: { id: true, name: true, deletedAt: true } });
      if (!target || target.deletedAt) throw new NotFoundError(t("backend.customer.notFound"));

      if (server.sshKeyId) throw new BusinessError(t("backend.server.transfer.sshKeyBound"));

      const bindings = await listServerStorageNodes(serverId, tx);
      const storageNodeIds = bindings.map(node => node.id);
      if (bindings.some(node => node.teamId !== server.teamId)) throw new ValidationError(t("backend.fileAgent.binding"));
      // Gateways verify old links offline. Their remote listener must stop before ownership changes.
      // Older uninstalls could clear all public markers while the listener still held the previous key.
      if (needsLegacyGatewayStop(server) ||
        server.directGatewayDesiredEnabled || server.fileProxyPort > 0 || server.publicUrl ||
        bindings.some(node => node.driver === "SFTP" && node.directAccessMode !== "PROXY" && node.publicBaseUrl)) {
        throw new BusinessError(t("backend.server.transfer.disableGateway"));
      }
      const blockers = await getServerTransferBlockers(serverId, bindings, tx);
      if (blockers.length > 0) {
        throw new BusinessError(t("backend.server.transfer.blocked", {
          dependencies: blockers.map(([name, count]) => `${t(`backend.server.transfer.blocker.${name}`)} ${count}`).join(", "),
        }));
      }

      const existingDefault = await tx.storageNode.findFirst({ where: { teamId: target.id, isDefault: true }, select: { id: true } });
      // Node deletion takes the node lock before cascading to its file binding.
      // Server credential rotation can touch that binding through a trigger.
      if (storageNodeIds.length) await tx.$queryRaw`
        SELECT id FROM "StorageNode" WHERE id IN (${Prisma.join(storageNodeIds)}) ORDER BY id FOR UPDATE`;
      // Revoke the old file credentials and their pending calls in this transaction,
      // including on schemas that were provisioned without the migration triggers.
      const agentNodeIds = bindings.filter(node => node.driver === "AGENT").map(node => node.id);
      if (agentNodeIds.length) {
        await tx.agentFileShare.deleteMany({ where: { serverId, storageNodeId: { in: agentNodeIds } } });
      }
      await tx.server.update({ where: { id: serverId }, data: {
        teamId: target.id, ...resetAgentForModeChange(),
        directGatewayKeyVersion: Math.max(firstDirectGatewayKeyVersion(server.operatingSystem), server.directGatewayKeyVersion) + 1,
        directGatewayDesiredDomain: null,
      } });
      await tx.storageNode.updateMany({ where: { serverId, driver: "SFTP" }, data: { directAccessMode: "PROXY", publicBaseUrl: null } });
      await Promise.all([
        tx.storageNode.updateMany({ where: { id: { in: storageNodeIds } }, data: { teamId: target.id, ...(existingDefault ? { isDefault: false } : {}) } }),
        tx.costEntry.updateMany({
          where: { sourceType: "server_monthly", sourceRef: serverId, effectiveDate: startOfMonthUtc(appTimeZoneDateKey().slice(0, 7)) },
          data: { teamId: target.id },
        }),
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
      // The new owner explicitly pairs the drive before file operations can resume.
      if (agentNodeIds.length) {
        await tx.storageNode.updateMany({ where: { id: { in: agentNodeIds } }, data: {
          healthStatus: "UNKNOWN", lastHealthyAt: null, lastHealthyTransport: null,
          lastHealthCheckAt: null, lastHealthError: null, lastHealthLatencyMs: null,
        } });
        await tx.agentFileShare.createMany({
          data: agentNodeIds.map(storageNodeId => ({ storageNodeId, serverId, teamId: target.id })),
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
