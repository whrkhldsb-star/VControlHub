import type { SessionPayload } from "@/lib/auth/session";
import { serverProfileTeamWhere } from "@/lib/auth/team-scope";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { BusinessError, NotFoundError } from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";
import { applyServerDirectGatewayState } from "./service-direct-gateway";
import { uninstallServerAgent } from "./agent-service";
import {
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
    const current = session
      ? await prisma.server.findFirst({
          where: { id: serverId, ...serverProfileTeamWhere(session) },
          include: { storageNode: { select: { id: true, driver: true } } },
        })
      : await prisma.server.findUnique({
          where: { id: serverId },
          include: { storageNode: { select: { id: true, driver: true } } },
        });
    const t = await serviceT();
    if (!current) throw new NotFoundError(t("backend.server.nodeNotFound"));

    const deletionImpact = await getServerDeletionImpact(serverId);
    const blockers = getBlockingServerDeletionImpact(deletionImpact);
    if (blockers.length > 0) {
      throw new BusinessError(t("backend.server.deleteBlockedByDependencies", {
        dependencies: describeServerDeletionBlockers(blockers, t),
      }));
    }

    let cleanupSkipped = false;
    if (
      current.fileProxyPort &&
      current.fileProxyPort > 0 &&
      current.storageNode?.driver === "SFTP"
    ) {
      const result = await applyServerDirectGatewayState({
        serverId,
        enabled: false,
        bestEffort: true,
      });
      cleanupSkipped = cleanupSkipped || result.cleanupSkipped;
    }
    if (current.managementMode === "AGENT") {
      const agentCleanup = await uninstallServerAgent(serverId);
      cleanupSkipped = cleanupSkipped || !agentCleanup.removed;
    }

    // Cleanup can take time. Recheck the current bindings and dependencies in the
    // transaction that removes the profile, including work added since confirmation.
    await prisma.$transaction(async tx => {
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
    }, { isolationLevel: "Serializable" });
    return cleanupSkipped
      ? { deleted: true, cleanupSkipped: true }
      : { deleted: true };
  } finally {
    await releaseLock();
  }
}
