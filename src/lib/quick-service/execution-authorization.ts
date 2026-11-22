import { loadApiTokenOwnerSession, loadJobOwnerSession } from "@/lib/api-token/authorization";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager, serverTeamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { SSH_ENDPOINT_IDENTITY_SELECT, type SshEndpointIdentity } from "@/lib/ssh/server-connection-select";
import { instanceKeyForTarget, targetFromService, type DockerTarget } from "./docker-cli";
import { quickServiceCapability, quickServiceEndpointFingerprint, quickServiceRemoteTarget } from "./target-identity";

export type QuickServiceRequester = {
  createdBy?: string | null;
  teamId?: string | null;
  expectedEndpoint?: SshEndpointIdentity;
};

/** Queue payloads cannot preserve a permission that the operator has lost. */
export async function assertQuickServiceExecutionAuthorized(job: QuickServiceRequester, identity: { instanceKey?: string; serverId?: string | null; action: keyof typeof quickServiceCapability; endpointFingerprint?: string }) {
  const target = await assertTargetAuthorized(job, targetFromService(identity), identity.action);
  if (target.kind === "remote" && !identity.endpointFingerprint) throw new ForbiddenError(t("backend.command.connectionChanged"));
  if (identity.endpointFingerprint && (target.kind !== "remote" || !target.endpoint || quickServiceEndpointFingerprint(target.endpoint) !== identity.endpointFingerprint)) {
    throw new ForbiddenError(t("backend.command.connectionChanged"));
  }
  return target;
}

async function assertTargetAuthorized(job: QuickServiceRequester, target: DockerTarget, action: keyof typeof quickServiceCapability): Promise<DockerTarget> {
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
    return target;
  }
  const server = await prisma.server.findFirst({
    where: { AND: [{ id: target.serverId, enabled: true, teamId: job.teamId ?? null, ...job.expectedEndpoint }, serverTeamWhere(session, quickServiceCapability[action])] },
    select: { teamId: true, ...SSH_ENDPOINT_IDENTITY_SELECT },
  });
  if (!server) throw new ForbiddenError(t("backend.quickService.targetInaccessible"));
  const { teamId, ...endpoint } = server;
  return { ...target, expectedTeamId: teamId, endpoint };
}

/** Authorize the exact target the lifecycle operation will hand to Docker. */
export async function resolveQuickServiceExecutionTarget(
  service: { instanceKey: string; serverId: string | null },
  requestedInstanceKey: string,
  action: keyof typeof quickServiceCapability,
  requester?: QuickServiceRequester,
) {
  const target = targetFromService(service);
  const instanceKey = instanceKeyForTarget(target);
  if (instanceKey !== requestedInstanceKey) throw new ForbiddenError(t("backend.quickService.targetMismatch"));
  if (requester) return assertTargetAuthorized(requester, target, action);
  if (target.kind === "local") return target;
  // The platform reconciliation sweep has no requester. Bind its remote
  // status read and subsequent database writes to the current owner, too.
  const server = await prisma.server.findUnique({
    where: { id: target.serverId, enabled: true }, select: { id: true, teamId: true, ...SSH_ENDPOINT_IDENTITY_SELECT },
  });
  if (!server) throw new ForbiddenError(t("backend.quickService.targetInaccessible"));
  return quickServiceRemoteTarget(server);
}
