import type { SessionPayload } from "@/lib/auth/session";
import { serverTeamWhere } from "@/lib/auth/team-scope";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { BusinessError, NotFoundError } from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";
import { applyServerDirectGatewayState } from "./service-direct-gateway";
import {
  getBlockingServerDeletionImpact,
  getServerDeletionImpact,
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
          where: { id: serverId, ...serverTeamWhere(session) },
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
        dependencies: blockers.map(([name, count]) => `${name}=${count}`).join(", "),
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
      cleanupSkipped = result.cleanupSkipped;
    }

    if (current.storageNode) {
      // Atomic: the storage node and its owning server must be removed
      // together — a mid-way failure would leave an orphan node pointing at
      // a server that no longer exists.
      await prisma.$transaction([
        prisma.storageNode.delete({ where: { id: current.storageNode.id } }),
        prisma.server.delete({ where: { id: serverId } }),
      ]);
    } else {
      await prisma.server.delete({ where: { id: serverId } });
    }
    return cleanupSkipped
      ? { deleted: true, cleanupSkipped: true }
      : { deleted: true };
  } finally {
    await releaseLock();
  }
}
