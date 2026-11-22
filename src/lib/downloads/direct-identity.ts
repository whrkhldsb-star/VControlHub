import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

type Endpoint = {
  id: string; teamId?: string | null; host: string; port: number; username: string; hostKeySha256: string | null;
  managementMode?: string; agentTokenHash?: string | null; operatingSystem?: string;
  storageNode?: { id: string; basePath: string | null } | null;
};

export function directEndpointIdentity(server: Endpoint) {
  return createHash("sha256").update(JSON.stringify([server.id, server.teamId ?? null, server.host.toLowerCase(),
    server.port, server.username, server.hostKeySha256, server.operatingSystem, server.managementMode,
    server.managementMode === "AGENT" ? server.agentTokenHash : null, server.storageNode?.id, server.storageNode?.basePath])).digest("hex");
}

export function directLaunchReceipt(value: unknown) {
  if (!value || typeof value !== "object" || !("directEndpoint" in value) || typeof value.directEndpoint !== "string") return null;
  return { endpoint: value.directEndpoint, dispatched: "phase" in value && value.phase === "dispatched" };
}

export function directEndpointChanged(task: { transferManifest?: unknown; server: Endpoint }) {
  const receipt = directLaunchReceipt(task.transferManifest);
  return !!receipt && receipt.endpoint !== directEndpointIdentity(task.server);
}

/** Keep the verified binding in place through the transaction that publishes its file index. */
export async function lockDirectResultBinding(tx: Prisma.TransactionClient, server: Endpoint, manifest: unknown) {
  const receipt = directLaunchReceipt(manifest);
  if (!receipt) return true;
  const [current] = await tx.$queryRaw<(Endpoint & { nodeId: string; basePath: string })[]>`
    SELECT s.id, s."teamId", s.host, s.port, s.username, s."hostKeySha256", s."managementMode", s."agentTokenHash",
      s."operatingSystem", n.id AS "nodeId", n."basePath"
    FROM servers s JOIN "StorageNode" n ON n."serverId" = s.id
    WHERE s.id = ${server.id} AND n.id = ${server.storageNode?.id ?? null} FOR SHARE OF s, n`;
  return !!current && receipt.endpoint === directEndpointIdentity({ ...current, storageNode: { id: current.nodeId, basePath: current.basePath } });
}
