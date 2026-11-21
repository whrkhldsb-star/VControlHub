import { createHash } from "node:crypto";
import type { SshEndpointIdentity } from "@/lib/ssh/server-connection-select";
import { ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

export const HUB_HOST_INSTANCE_KEY = "hub-host";

export function isQuickServiceTargetConsistent(instanceKey: string, serverId: string | null): boolean {
  return instanceKey === HUB_HOST_INSTANCE_KEY ? serverId === null : Boolean(instanceKey) && serverId === instanceKey;
}

// The queue and worker must enforce the same per-node capability for each operation.
export const quickServiceCapability = {
  install: "manage",
  start: "manage",
  stop: "manage",
  sync: "manage",
  update: "manage",
  uninstall: "manage",
} as const;

export function quickServiceRemoteTarget({ id, teamId, ...endpoint }: SshEndpointIdentity & { id: string; teamId: string | null }) {
  if (id === HUB_HOST_INSTANCE_KEY) throw new ForbiddenError(t("backend.quickService.targetMismatch"));
  return { kind: "remote" as const, serverId: id, expectedTeamId: teamId, endpoint };
}

// Job payloads are visible in task history. Bind the target without copying its Agent token hash into the job.
export function quickServiceEndpointFingerprint(endpoint: SshEndpointIdentity) {
  const { host, port, username, hostKeySha256, managementMode, agentTokenHash } = endpoint;
  return createHash("sha256").update(JSON.stringify([host, port, username, hostKeySha256, managementMode, agentTokenHash])).digest("hex");
}
