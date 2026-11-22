import { createHash, randomUUID } from "node:crypto";

export const manualRunKeyPrefix = "scheduled-task:retry:";

export function manualRunPrefix(initiatorId: string) {
  return manualRunKeyPrefix + encodeURIComponent(initiatorId) + ":";
}

/** The request keeps its plan author as requester. Only the internal producer can mint this key. */
export function manualRunKey(initiatorId: string) {
  return manualRunPrefix(initiatorId) + randomUUID();
}

export function manualRunInitiator(key: string | null) {
  if (!key?.startsWith(manualRunKeyPrefix)) return null;
  const end = key.lastIndexOf(":");
  if (end < manualRunKeyPrefix.length) return null;
  try { return decodeURIComponent(key.slice(manualRunKeyPrefix.length, end)) || null; }
  catch { return null; }
}

export const approvalEndpointSelect = {
  host: true, port: true, username: true, hostKeySha256: true, managementMode: true,
  agentTokenHash: true, teamId: true, operatingSystem: true, connectionType: true,
} as const;

type ServerEndpoint = { [K in Exclude<keyof typeof approvalEndpointSelect, "port">]: string | null } & { port: number };

/** An immutable, per-target receipt in the request's existing execution journal. */
export function approvalReceiptId(targetId: string, server: ServerEndpoint) {
  const identity = [targetId, server.host, server.port, server.username, server.hostKeySha256,
    server.managementMode, server.agentTokenHash, server.teamId, server.operatingSystem, server.connectionType];
  return "approval-" + createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
