import { createHash, randomBytes } from "node:crypto";
import { DB_UTC_NOW } from "@/lib/db/utc-now";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BusinessError, ConflictError, ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { teamWhere, serverTeamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const unavailable = () => new BusinessError(t("backend.fileAgent.unavailable"));
const shareSelect = { id: true, tokenHash: true, seenAt: true, writable: true } as const;
type Channel = { id: string; tokenHash: string; writable: boolean };
type Tx = Prisma.TransactionClient;
type Payload = Record<string, string | number | boolean>;
const readOperations = ["stat", "list", "read", "checksum"];
export const FILE_AGENT_CLAIM_LEASE_MS = 15_000;
export const FILE_AGENT_RECEIPT_GRACE_MS = 60 * 60_000;

export function fileWriteFence(serverId: string, jobId = "") {
  return `file-agent-write:${serverId}:${jobId}`;
}

// A delivery can outlive the caller and its polling lease. Only a terminal receipt clears the fence.
export function pendingFileWrites(tx: Tx, binding: { serverId: string } | { id: string }) {
  return tx.agentFileCall.count({ where: {
    share: binding, claimed: true, result: { equals: Prisma.DbNull },
    NOT: { OR: readOperations.map(op => ({ payload: { path: ["op"], equals: op } })) },
  } });
}

export async function pairFileShare(nodeId: string, session: SessionPayload) {
  return prisma.$transaction(async (tx) => {
    // Rotation updates the server first, then its shares. Keep that order and
    // pin the exact binding before reading the identity that signs the pair.
    const locked = await tx.$queryRaw<Array<{ id: string; serverId: string }>>`
      SELECT sh.id, sh."serverId" FROM servers s JOIN agent_file_shares sh ON sh."serverId" = s.id
      WHERE sh."storageNodeId" = ${nodeId} FOR SHARE OF s`;
    const binding = locked[0];
    if (!binding) throw unavailable();
    const share = await tx.agentFileShare.findFirst({
      where: {
        id: binding.id, serverId: binding.serverId, storageNodeId: nodeId,
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
    if (await pendingFileWrites(tx, { id: binding.id }) || await tx.setting.count({ where: { key: { startsWith: fileWriteFence(binding.serverId) } } })) throw unavailable();
    const token = `vcf_${share.id}_${randomBytes(32).toString("hex")}`;
    // Node deletion and reconfiguration claim the node before its file binding.
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
    await tx.agentFileShare.update({
      where: { id: share.id, serverId: binding.serverId, storageNodeId: nodeId },
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
    await tx.shareLink.updateMany({ where: { storageNodeId: nodeId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.agentFileCall.deleteMany({ where: { shareId: share.id } });
    return token;
  });
}

// Each stage needs the preceding locked row. Pairing, transfer and node deletion
// can therefore take the same server, node and binding locks without a cycle.
async function liveChannel(tx: Tx, by: { nodeId?: string; hash?: string; serverId?: string }) {
  const rows = await tx.$queryRaw<Array<Channel & { serverId: string; seenAt: Date | null; rootIdentity: string | null }>>`
    WITH locked_server AS MATERIALIZED (
      SELECT s.id AS "serverId", s."teamId", s."agentTokenHash", sh.id AS "shareId", sh."storageNodeId", sh."tokenHash"
      FROM servers s JOIN agent_file_shares sh ON sh."serverId" = s.id
      WHERE ${by.nodeId ? Prisma.sql`sh."storageNodeId" = ${by.nodeId}` : Prisma.sql`sh."tokenHash" = ${by.hash}`}
        ${by.serverId ? Prisma.sql`AND s.id = ${by.serverId}` : Prisma.empty}
        AND s.enabled AND s."managementMode" = 'AGENT'
      ${by.hash ? Prisma.sql`FOR NO KEY UPDATE OF s` : Prisma.sql`FOR SHARE OF s`}
    ), locked_node AS MATERIALIZED (
      SELECT s.* FROM locked_server s JOIN "StorageNode" n ON n.id = s."storageNodeId"
      WHERE n.driver = 'AGENT' AND n."teamId" IS NOT DISTINCT FROM s."teamId"
        AND NOT EXISTS (SELECT 1 FROM teams WHERE id = n."teamId" AND "deletedAt" IS NOT NULL)
      FOR SHARE OF n
    )
    SELECT sh.id, sh."serverId", sh."tokenHash", sh.writable, sh."seenAt", sh."rootIdentity"
    FROM locked_node n JOIN agent_file_shares sh ON sh.id = n."shareId"
    WHERE sh."serverId" = n."serverId" AND sh."storageNodeId" = n."storageNodeId"
      AND sh."tokenHash" = n."tokenHash" AND sh."agentHash" = n."agentTokenHash"
      AND sh."teamId" IS NOT DISTINCT FROM n."teamId"
    FOR UPDATE OF sh`;
  return rows[0];
}

export async function getFileChannel(nodeId: string, serverId?: string, expectedRoot?: string) {
  const channel = await prisma.$transaction((tx) => liveChannel(tx, { nodeId, serverId }));
  if (!channel || (expectedRoot !== undefined && channel.rootIdentity !== expectedRoot)) throw unavailable();
  return channel;
}

// An optional transaction guard follows the client through staging, but only fences the publish handoff.
export const agentPublishGuard = new AsyncLocalStorage<(tx: Tx) => Promise<void>>();

export async function callFileAgent(nodeId: string, channel: Channel, payload: Payload) {
  const write = !readOperations.includes(String(payload.op));
  const ttl = ["publish", "copy", "copy-step", "checksum"].includes(String(payload.op)) ? 10 * 60_000 : 45_000;
  const expiresAt = new Date(Date.now() + ttl);
  const call = await prisma.$transaction(async (tx) => {
    if (payload.op === "publish") await agentPublishGuard.getStore()?.(tx);
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
        if (payload.op === "rmdir") {
          if (reply.error === "exists") throw new ConflictError(t("backend.storage.recycledDirectoryConflict"));
          if (reply.error === "changed") throw new ConflictError(t("backend.storage.recycleBatchChanged"));
        }
        if (reply.error === "invalid" && payload.op === "copy-step") throw new BusinessError(t("backend.fileAgent.copyUpgrade"));
        if (reply.error) throw new BusinessError(t("backend.fileAgent.refused"));
        return reply;
      }
      await delay(pause);
    }
    throw unavailable();
  } finally {
    // A claimed write may already be on disk when its caller stops waiting.
    await prisma.agentFileCall.deleteMany({ where: { id: call.id, ...(write ? {
      OR: [{ claimed: false }, { result: { not: Prisma.DbNull } }],
    } : {}) } });
  }
}

export async function sweepExpiredFileAgentCalls(now = new Date()) {
  const grace = new Date(now.getTime() - FILE_AGENT_RECEIPT_GRACE_MS);
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    WITH swept AS (
      DELETE FROM agent_file_calls c USING agent_file_shares s
      WHERE c."shareId" = s.id AND c."expiresAt" <= ${now}
        AND (NOT c.claimed OR c.result IS NOT NULL OR c.payload->>'op' IN ('stat','list','read','checksum') OR c."expiresAt" <= ${grace})
      RETURNING c.id, s."serverId", c.claimed, c.result, c.payload, c."tokenHash"
    ), fenced AS (
      INSERT INTO settings (key, value, "updatedAt")
      SELECT 'file-agent-write:' || "serverId" || ':' || id, "tokenHash", ${DB_UTC_NOW}
      FROM swept WHERE claimed AND result IS NULL AND COALESCE(payload->>'op','') NOT IN ('stat','list','read','checksum')
      ON CONFLICT DO NOTHING
    )
    SELECT count(*)::int AS count FROM swept`;
  return rows[0]!;
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
export async function pollFileAgent(hash: string, rootIdentity: string, writable: boolean, receipt?: Receipt, deliveryVersion = 1) {
  return prisma.$transaction(async (tx) => {
    const share = await liveChannel(tx, { hash });
    if (!share || (share.rootIdentity && share.rootIdentity !== rootIdentity)) return null;
    const now = new Date();
    const observed: { lastReadAt?: Date; lastWriteAt?: Date } = {};
    if (receipt) {
      // Serialize with the atomic sweep before acknowledging its durable fence.
      await tx.$queryRaw`SELECT id FROM agent_file_calls WHERE id = ${receipt.id} AND "shareId" = ${share.id} FOR UPDATE`;
      await tx.setting.deleteMany({ where: { key: fileWriteFence(share.serverId, receipt.id), value: hash } });
      const where = {
        id: receipt.id,
        shareId: share.id,
        tokenHash: hash,
        claimed: true,
        result: { equals: Prisma.DbNull },
      };
      const call = await tx.agentFileCall.findFirst({ where, select: { payload: true, expiresAt: true } });
      if (call) {
        const { op, step } = call.payload as Payload;
        if (call.expiresAt > now || (!readOperations.includes(String(op)) && call.expiresAt.getTime() + FILE_AGENT_RECEIPT_GRACE_MS > now.getTime())) {
          const completed = await tx.agentFileCall.updateMany({ where, data: { payload: {}, result: receipt.result } });
          if (completed.count && !receipt.result.error && (op === "publish" || op === "copy" || (op === "copy-step" && step === "promote"))) {
            observed.lastWriteAt = now;
          }
        } else if (!readOperations.includes(String(op))) {
          // Receipt is past retention. Prevent the sweep from backfilling a fence for completed work.
          await tx.agentFileCall.updateMany({ where, data: { claimed: false, payload: {} } });
        }
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
    // Only v2 Agents persist job IDs. A legacy claim has no lease and must
    // never be replayed across an upgrade or to a downgraded Agent.
    const leasedDelivery = deliveryVersion === 2;
    const eligible = {
      shareId: share.id, tokenHash: hash, expiresAt: { gt: now }, result: { equals: Prisma.DbNull },
      ...(writable ? {} : { AND: [{ OR: readOperations.map(op => ({ payload: { path: ["op"], equals: op } })) }] }),
      OR: [
        { claimed: false },
        ...(leasedDelivery ? [{ payload: { path: ["claimLeaseUntilMs"], lte: now.getTime() } }] : []),
      ],
    };
    const next = await tx.agentFileCall.findFirst({
      where: eligible, orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      select: { id: true, payload: true, expiresAt: true },
    });
    if (!next) return { job: null };
    const operation = { ...next.payload as Payload };
    delete operation.claimLeaseUntilMs;
    // liveChannel serializes polls for this share. The conditional update
    // also handles a caller cancelling its unclaimed row in the meantime.
    const remainingMs = next.expiresAt.getTime() - Date.now();
    if (remainingMs <= 0) return { job: null };
    const claimed = await tx.agentFileCall.updateMany({
      where: { ...eligible, id: next.id },
      data: { claimed: true, ...(leasedDelivery ? { payload: { ...operation, claimLeaseUntilMs: now.getTime() + FILE_AGENT_CLAIM_LEASE_MS } } : {}) },
    });
    if (!claimed.count) return { job: null };
    if (!readOperations.includes(String(operation.op))) {
      // Call rows are unlogged and can cascade away. Keep the fence in a logged table.
      await tx.$queryRaw`
        WITH touched AS (UPDATE servers SET "updatedAt" = ${DB_UTC_NOW} WHERE id = ${share.serverId} RETURNING id)
        INSERT INTO "settings" (key, value, "updatedAt") SELECT ${fileWriteFence(share.serverId, next.id)}, ${hash}, ${DB_UTC_NOW} FROM touched
        ON CONFLICT (key) DO NOTHING`;
    }
    const deliveryMs = next.expiresAt.getTime() - Date.now();
    if (deliveryMs <= 0) {
      if (!("claimLeaseUntilMs" in (next.payload as Payload))) {
        // No previous executor. This transaction withheld the first delivery.
        await tx.agentFileCall.deleteMany({ where: { id: next.id } });
        await tx.$queryRaw`DELETE FROM "settings" WHERE key = ${fileWriteFence(share.serverId, next.id)}`;
      }
      return { job: null };
    }
    return { job: { id: next.id, remainingMs: deliveryMs, operation } };
  });
}
