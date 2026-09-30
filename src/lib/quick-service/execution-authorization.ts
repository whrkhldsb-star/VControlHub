import { loadApiTokenOwnerSession } from "@/lib/api-token/authorization";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager, serverTeamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { HUB_HOST_INSTANCE_KEY } from "./docker-cli";

/** Queue payloads cannot preserve a permission that the operator has lost. */
export async function assertQuickServiceExecutionAuthorized(job: {
  createdBy?: string | null;
  teamId?: string | null;
}, target: { instanceKey?: string; serverId?: string | null }) {
  if (!job.createdBy) throw new ForbiddenError(t("backend.quickService.requesterMissing"));
  const account = await loadApiTokenOwnerSession(job.createdBy);
  if (!account) throw new ForbiddenError(t("backend.quickService.requesterDisabled"));
  const global = isGlobalTeamManager(account);
  const session = global ? account : job.teamId ? await loadApiTokenOwnerSession(job.createdBy, job.teamId) : null;
  if (!session || !sessionHasPermission(session, "docker:manage")) {
    throw new ForbiddenError(t("backend.quickService.permissionRevoked"));
  }
  const instanceKey = target.instanceKey ?? HUB_HOST_INSTANCE_KEY;
  if (instanceKey === HUB_HOST_INSTANCE_KEY) {
    if (!global) throw new ForbiddenError(t("backend.quickService.platformRequired"));
    return;
  }
  if (target.serverId && target.serverId !== instanceKey) throw new ForbiddenError(t("backend.quickService.targetMismatch"));
  const server = await prisma.server.findFirst({
    where: { AND: [{ id: instanceKey, enabled: true }, serverTeamWhere(session, "connect")] },
    select: { id: true },
  });
  if (!server) throw new ForbiddenError(t("backend.quickService.targetInaccessible"));
}
