import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BusinessError, ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { teamWhere, serverTeamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const unavailable = () => new BusinessError(t("backend.fileAgent.unavailable"));
const shareSelect = { id: true, tokenHash: true, seenAt: true, writable: true } as const;
type Channel = { id: string; tokenHash: string; writable: boolean };
type Tx = Prisma.TransactionClient;
type Payload = Record<string, string | number | boolean>;

export async function pairFileShare(nodeId: string, session: SessionPayload) {
  return prisma.$transaction(async (tx) => {
    const share = await tx.agentFileShare.findFirst({
      where: {
        storageNodeId: nodeId,
        node: { is: { driver: "AGENT", ...teamWhere(session) } },
        server: { is: { enabled: true, managementMode: "AGENT", ...serverTeamWhere(session, "connect") } },
      },
      select: {
        id: true,
        node: { select: { teamId: true } },
        server: { select: { agentTokenHash: true, teamId: true } },
      },
    });
    if (!share?.server.agentTokenHash || share.server.teamId !== share.node.teamId) throw unavailable();
    const token = `vcf_${share.id}_${randomBytes(32).toString("hex")}`;
    await tx.agentFileShare.update({
      where: { id: share.id },
      data: {
        teamId: share.node.teamId,
        tokenHash: digest(token),
        agentHash: share.server.agentTokenHash,
        rootIdentity: null,
        seenAt: null,
        writable: false,
        lastReadAt: null,
        lastWriteAt: null,
      },
    });
    await tx.storageNode.update({
      where: { id: nodeId },
      data: {
        lastHealthyAt: null,
        lastHealthyTransport: null,
        healthStatus: "UNKNOWN",
        lastHealthCheckAt: null,
        lastHealthError: null,
        lastHealthLatencyMs: null,
      },
    });
    await tx.shareLink.updateMany({ where: { storageNodeId: nodeId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.agentFileCall.deleteMany({ where: { shareId: share.id } });
    return token;
  });
}

// Lock all three records until the enqueue or claim commits. Re-pairing, moving a
// drive or revoking a management identity cannot expose old work to its successor.
async function liveChannel(tx: Tx, by: { nodeId?: string; hash?: string; serverId?: string }) {
  const rows = await tx.$queryRaw<Array<Channel & { seenAt: Date | null; rootIdentity: string | null }>>`
    SELECT sh.id, sh."tokenHash", sh.writable, sh."seenAt", sh."rootIdentity" FROM agent_file_shares sh
    JOIN servers s ON s.id = sh."serverId" JOIN "StorageNode" n ON n.id = sh."storageNodeId"
    WHERE ${by.nodeId ? Prisma.sql`n.id = ${by.nodeId}` : Prisma.sql`sh."tokenHash" = ${by.hash}`}
      ${by.serverId ? Prisma.sql`AND s.id = ${by.serverId}` : Prisma.empty}
      AND n.driver = 'AGENT' AND s.enabled AND s."managementMode" = 'AGENT'
      AND sh."tokenHash" IS NOT NULL AND sh."agentHash" = s."agentTokenHash"
      AND s."teamId" IS NOT DISTINCT FROM n."teamId" AND sh."teamId" IS NOT DISTINCT FROM n."teamId"
      AND NOT EXISTS (SELECT 1 FROM teams WHERE id = n."teamId" AND "deletedAt" IS NOT NULL)
    FOR UPDATE OF sh FOR SHARE OF s,n`;
  return rows[0];
}

export async function getFileChannel(nodeId: string, serverId?: string, expectedRoot?: string) {
  const channel = await prisma.$transaction((tx) => liveChannel(tx, { nodeId, serverId }));
  if (!channel || (expectedRoot !== undefined && channel.rootIdentity !== expectedRoot)) throw unavailable();
  return channel;
}

export async function callFileAgent(nodeId: string, channel: Channel, payload: Payload) {
  const write = !["stat", "list", "read", "checksum"].includes(String(payload.op));
  const ttl = ["publish", "copy", "copy-step", "checksum"].includes(String(payload.op)) ? 10 * 60_000 : 45_000;
  const expiresAt = new Date(Date.now() + ttl);
  const call = await prisma.$transaction(async (tx) => {
    const current = await liveChannel(tx, { nodeId });
    if (
      !current?.seenAt ||
      current.tokenHash !== channel.tokenHash ||
      current.seenAt.getTime() < Date.now() - 90_000
    )
      throw unavailable();
    if (write && !current.writable) throw new ForbiddenError(t("backend.fileAgent.readOnly"));
    const count = await tx.agentFileCall.count({ where: { shareId: current.id, expiresAt: { gt: new Date() } } });
    if (count >= 16) throw new BusinessError(t("backend.storage.finalizationBusy"));
    return tx.agentFileCall.create({
      data: { shareId: current.id, tokenHash: current.tokenHash, payload, expiresAt },
      select: { id: true },
    });
  });
  try {
    for (let pause = 40; Date.now() < expiresAt.getTime(); pause = Math.min(600, pause * 1.4)) {
      const row = await prisma.agentFileCall.findUnique({ where: { id: call.id }, select: { result: true } });
      if (!row) throw unavailable();
      if (row.result !== null) {
        const current = await getFileChannel(nodeId);
        if (current.tokenHash !== channel.tokenHash) throw unavailable();
        const reply = row.result as Record<string, unknown>;
        if (reply.error === "missing")
          throw Object.assign(new Error(t("backend.fileAgent.missing")), { code: "ENOENT" });
        if (reply.error === "invalid" && payload.op === "copy-step") throw new BusinessError(t("backend.fileAgent.copyUpgrade"));
        if (reply.error) throw new BusinessError(t("backend.fileAgent.refused"));
        return reply;
      }
      await delay(pause);
    }
    throw unavailable();
  } finally {
    await prisma.agentFileCall.deleteMany({ where: { id: call.id } });
  }
}

export async function recordVerifiedFileRead(channel: Channel) {
  await prisma.agentFileShare.updateMany({
    where: { id: channel.id, tokenHash: channel.tokenHash },
    data: { lastReadAt: new Date() },
  });
}

type Receipt = { id: string; result: Record<string, Prisma.InputJsonValue | null> };
export function parseFileCredential(authorization: string | null) {
  const match = /^Bearer (vcf_[a-z0-9]{16,40}_[a-f0-9]{64})$/.exec(authorization ?? "");
  return match ? digest(match[1]!) : null;
}
export async function pollFileAgent(hash: string, rootIdentity: string, writable: boolean, receipt?: Receipt) {
  return prisma.$transaction(async (tx) => {
    const share = await liveChannel(tx, { hash });
    if (!share || (share.rootIdentity && share.rootIdentity !== rootIdentity)) return null;
    const now = new Date();
    const observed: { lastReadAt?: Date; lastWriteAt?: Date } = {};
    if (receipt) {
      const where = {
        id: receipt.id,
        shareId: share.id,
        tokenHash: hash,
        claimed: true,
        expiresAt: { gt: now },
        result: { equals: Prisma.DbNull },
      };
      const call = await tx.agentFileCall.findFirst({ where, select: { payload: true } });
      if (call) {
        const { op } = call.payload as Payload;
        await tx.agentFileCall.updateMany({ where, data: { payload: {}, result: receipt.result } });
        if (!receipt.result.error && (op === "publish" || (op === "copy-step" && (call.payload as Payload).step === "promote"))) observed.lastWriteAt = now;
      }
    }
    if (
      !share.seenAt ||
      now.getTime() - share.seenAt.getTime() >= 20_000 ||
      share.writable !== writable ||
      Object.keys(observed).length
    ) {
      await tx.agentFileShare.update({
        where: { id: share.id },
        data: { seenAt: now, rootIdentity, writable, ...observed },
        select: shareSelect,
      });
    }
    const next = await tx.agentFileCall.findFirst({
      where: { shareId: share.id, tokenHash: hash, claimed: false, expiresAt: { gt: now } },
      orderBy: { expiresAt: "asc" },
    });
    if (!next) return { job: null };
    await tx.agentFileCall.update({ where: { id: next.id }, data: { claimed: true } });
    return { job: { id: next.id, operation: next.payload } };
  });
}
