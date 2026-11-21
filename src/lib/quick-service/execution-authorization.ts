import { loadApiTokenOwnerSession, loadJobOwnerSession } from "@/lib/api-token/authorization";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager, serverTeamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { instanceKeyForTarget, targetFromService, type DockerTarget } from "./docker-cli";

export type QuickServiceRequester = {
  createdBy?: string | null;
  teamId?: string | null;
};

/** Queue payloads cannot preserve a permission that the operator has lost. */
export async function assertQuickServiceExecutionAuthorized(job: QuickServiceRequester, identity: { instanceKey?: string; serverId?: string | null }) {
  await assertTargetAuthorized(job, targetFromService(identity));
}

async function assertTargetAuthorized(job: QuickServiceRequester, target: DockerTarget) {
  if (!job.createdBy) throw new ForbiddenError(t("backend.quickService.requesterMissing"));
  const account = await loadApiTokenOwnerSession(job.createdBy);
  if (!account) throw new ForbiddenError(t("backend.quickService.requesterDisabled"));
  const global = isGlobalTeamManager(account);
  // The job's customer, not the one an administrator has selected now.
  const session = global || job.teamId ? await loadJobOwnerSession(job.createdBy, job.teamId) : null;
  if (!session || !sessionHasPermission(session, "docker:manage")) {
    throw new ForbiddenError(t("backend.quickService.permissionRevoked"));
  }
  if (target.kind === "local") {
    if (!global) throw new ForbiddenError(t("backend.quickService.platformRequired"));
    return;
  }
  const server = await prisma.server.findFirst({
    where: { AND: [{ id: target.serverId, enabled: true }, serverTeamWhere(session, "connect")] },
    select: { id: true },
  });
  if (!server) throw new ForbiddenError(t("backend.quickService.targetInaccessible"));
}

/** Authorize the exact target the lifecycle operation will hand to Docker. */
export async function resolveQuickServiceExecutionTarget(
  service: { instanceKey: string; serverId: string | null },
  requestedInstanceKey: string,
  requester?: QuickServiceRequester,
) {
  const target = targetFromService(service);
  const instanceKey = instanceKeyForTarget(target);
  if (instanceKey !== requestedInstanceKey) throw new ForbiddenError(t("backend.quickService.targetMismatch"));
  if (requester) await assertTargetAuthorized(requester, target);
  return target;
}
