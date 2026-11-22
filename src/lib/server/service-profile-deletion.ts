import type { SessionPayload } from "@/lib/auth/session";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { BusinessError, NotFoundError } from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";
import { loadServerForDirectGateway, removeDeletedServerGateway } from "./service-direct-gateway";
import { removeDeletedServerAgent } from "./agent-service";
import {
  countActiveFileProxies,
  describeServerDeletionBlockers,
  getBlockingServerDeletionImpact,
  getServerDeletionImpact,
  listServerStorageNodes,
} from "./service-deletion-impact";

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

export async function deleteServerProfile(
  serverId: string,
  session?: TeamSession | null,
) {
  const releaseLock = await acquireAdvisoryLock("server-delete", serverId);
  try {
    const t = await serviceT();
    const initial = await loadServerForDirectGateway(serverId, session);
    if (!initial) throw new NotFoundError(t("backend.server.nodeNotFound"));
    const releaseHost = await acquireAdvisoryLock("server-host", initial.host.toLowerCase());
    try {
      const current = await prisma.$transaction(async tx => {
        const server = await loadServerForDirectGateway(serverId, session, tx);
        if (!server || server.host !== initial.host) throw new NotFoundError(t("backend.server.nodeNotFound"));
        if (await countActiveFileProxies(serverId, tx)) throw new BusinessError(t("backend.server.deleteBlockedByDependencies", {
          dependencies: t("backend.server.transfer.blocker.fileProxies"),
        }));
        const bindings = await listServerStorageNodes(serverId, tx);
        const remaining = getBlockingServerDeletionImpact(await getServerDeletionImpact(serverId, tx, bindings));
        if (remaining.length) throw new BusinessError(t("backend.server.deleteBlockedByDependencies", {
          dependencies: describeServerDeletionBlockers(remaining, t),
        }));
        // Native drives are independently configured. An empty drive can be paired again.
        const agentIds = bindings.filter(node => node.driver === "AGENT").map(node => node.id);
        if (agentIds.length) await tx.storageNode.updateMany({ where: { id: { in: agentIds } }, data: {
          healthStatus: "UNKNOWN", lastHealthyAt: null, lastHealthyTransport: null,
          lastHealthCheckAt: null, lastHealthError: null, lastHealthLatencyMs: null,
        } });
        for (const node of bindings) {
          if (node.driver !== "AGENT") await tx.storageNode.delete({ where: { id: node.id, serverId } });
        }
        await tx.server.delete({ where: { id: serverId } });
        return server;
      }, { isolationLevel: "Serializable" });
      // Use the committed snapshot while the original host is still reserved.
      const gateway = current.fileProxyPort > 0 && current.storageNode?.driver === "SFTP"
        ? await removeDeletedServerGateway(current).catch(() => ({ cleanupSkipped: true })) : null;
      const agent = current.managementMode === "AGENT"
        ? await removeDeletedServerAgent(current).catch(() => ({ removed: false })) : null;
      return gateway?.cleanupSkipped || (agent && !agent.removed)
        ? { deleted: true, cleanupSkipped: true }
        : { deleted: true };
    } finally {
      await releaseHost();
    }
  } finally {
    await releaseLock();
  }
}
