/**
 * Offsite (S3) retention: delete objects under pathPrefix older than retentionDays.
 * UI documents this as a lifecycle job; implement here so the setting is not dead.
 */
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { offsiteDestination } from "@/lib/storage/offsite/destination";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { loadOffsiteConfig, validateOffsiteConfigForUse } from "@/lib/storage/offsite/schema";
import { assertDeletableObjectKey, S3Client, type S3Object } from "@/lib/storage/offsite/s3-client";

import type { Prisma } from "@prisma/client";
import type { OffsitePruneSummary } from "@/lib/storage/offsite/retention";
import { z } from "zod";

import { PLATFORM_RECEIPT_PREFIX, platformOffsiteDestination } from "./service-types";

const logger = createLogger("offsite-retention");
const receiptSchema = z.object({
  destination: z.string(), key: z.string(), type: z.string(), versionId: z.string().nullable(), uploadedAt: z.string().datetime(),
});
type Receipt = z.infer<typeof receiptSchema> & { id: string; value: string };

async function platformReceipts(destination: string) {
  const bound = new Map<string, string>();
  const receipts: Receipt[] = [];
  let after = "";
  for (;;) {
    const rows = await prisma.setting.findMany({ where: { key: { startsWith: PLATFORM_RECEIPT_PREFIX, gt: after } },
      select: { key: true, value: true }, orderBy: { key: "asc" }, take: 500 });
    for (const row of rows) {
      const receipt = receiptSchema.parse(JSON.parse(row.value));
      const id = row.key.slice(PLATFORM_RECEIPT_PREFIX.length);
      bound.set(id, receipt.key);
      if (receipt.destination === destination) receipts.push({ ...receipt, id, value: row.value });
    }
    if (rows.length < 500) break;
    after = rows[rows.length - 1]!.key;
  }
  const historical = await prisma.backupRecord.findMany({ where: { offsiteKey: { not: null } }, select: { id: true, offsiteKey: true } });
  const unbound = historical.flatMap((r) => r.offsiteKey && bound.get(r.id) !== r.offsiteKey ? [r.offsiteKey] : []);
  return { receipts, unbound };
}

async function expireReceipt(tx: Prisma.TransactionClient, receipt: Receipt) {
  const removed = await tx.setting.deleteMany({ where: { key: PLATFORM_RECEIPT_PREFIX + receipt.id, value: receipt.value } });
  if (removed.count) await tx.backupRecord.updateMany({ where: { id: receipt.id, offsiteKey: receipt.key },
    data: { offsiteKey: null, offsiteUploadedAt: null } });
  return removed.count;
}

export async function pruneOffsiteObjects(options?: {
  now?: Date;
  maxDeletes?: number;
}): Promise<OffsitePruneSummary> {
  const now = options?.now ?? new Date();
  const maxDeletes = options?.maxDeletes ?? 500;
  const config = await loadOffsiteConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      skipped: "offsite disabled",
      listed: 0,
      deleted: 0, deletedVersions: 0, hiddenCurrent: 0,
      errors: [],
      retentionDays: config.retentionDays,
      cutoffIso: now.toISOString(),
    };
  }
  const issues = validateOffsiteConfigForUse(config);
  if (issues.length > 0) {
    return {
      enabled: true,
      skipped: issues.join("; "),
      listed: 0,
      deleted: 0, deletedVersions: 0, hiddenCurrent: 0,
      errors: [],
      retentionDays: config.retentionDays,
      cutoffIso: now.toISOString(),
    };
  }

  const retentionDays = Math.max(1, config.retentionDays);
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });

  const prefix = (config.pathPrefix || "vcontrolhub-backups/").replace(/\/?$/, "/");
  // The newest offsite copy of each kind is never pruned by age: if uploads
  // have been failing for longer than the window, age alone removed the last
  // copy there was.
  const destination = offsiteDestination(config);
  const { receipts, unbound } = await platformReceipts(platformOffsiteDestination(config));
  const protectedObjects = await newestOffsiteObjects(destination, receipts, unbound);
  let listed = 0;
  let deleted = 0;
  let deletedVersions = 0;
  let hiddenCurrent = 0;
  const errors: string[] = [];
  let errorCount = 0;
  const warn = (message: string, key: string, error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    errorCount++;
    if (errors.length < 20) errors.push(`${key}: ${reason.slice(0, 200)}`);
    logger.warn(message, { key, error: reason });
  };
  let token: string | undefined;
  // Disaster-recovery bundles (recovery/) are uploaded by a script and have no database row, so they were pruned by
  // age alone - the last one included. The newest of them is kept like the newest copy of every other kind.
  const recoveryPrefix = `${prefix}recovery/`;
  const recovery: Array<{ key: string; size: number; at: number }> = [];

  const versionedKeys = new Set<string>();
  const plainReceipts = new Map<string, Receipt[]>();
  for (const receipt of receipts) {
    const { key, versionId } = receipt;
    if (!versionId) {
      const entries = plainReceipts.get(key) ?? [];
      entries.push(receipt);
      plainReceipts.set(key, entries);
      continue;
    }
    if (!key.startsWith(prefix) || protectedObjects.unversioned.has(key) || protectedObjects.versions.get(key)?.has(versionId)) continue;
    versionedKeys.add(key);
    if (deleted >= maxDeletes || new Date(receipt.uploadedAt) >= cutoff) continue;
    try {
      assertDeletableObjectKey(key);
      const outcome = await prisma.$transaction(async (tx) =>
        await expireReceipt(tx, receipt) ? client.deleteObject(key, versionId) : null);
      if (outcome === "deleted") { deleted++; deletedVersions++; }
    } catch (error) { warn("platform backup version prune failed", key, error); }
  }
  let cursor: string | undefined;
  while (deleted < maxDeletes) {
    const rows: Array<{ id: string; offsiteKey: string | null; offsiteVersionId: string | null }> = await prisma.vpsBackupRecord.findMany({
      where: { offsiteDestination: destination, offsiteKey: { startsWith: escapeLikeLiteral(prefix) }, offsiteVersionId: { not: null }, offsiteUploadedAt: { lt: cutoff } },
      select: { id: true, offsiteKey: true, offsiteVersionId: true }, orderBy: { id: "asc" }, take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) {
      const { offsiteKey: key, offsiteVersionId: version } = row;
      if (!key || !version || protectedObjects.unversioned.has(key) || protectedObjects.versions.get(key)?.has(version) || deleted >= maxDeletes) continue;
      versionedKeys.add(key);
      try {
        assertDeletableObjectKey(key);
        if (!key.startsWith(prefix)) throw new Error("Object key outside the listed prefix");
        // Keep the ledger retryable on S3 failure or an uncertain transaction commit.
        const removed = await prisma.$transaction(async tx => {
          const result = await tx.vpsBackupRecord.updateMany({
            where: { id: row.id, offsiteKey: key, offsiteVersionId: version, offsiteDestination: destination, offsiteUploadedAt: { lt: cutoff } },
            data: { offsiteKey: null, offsiteUploadedAt: null, offsiteVersionId: null },
          });
          return result.count ? client.deleteObject(key, version) : null;
        });
        if (removed === "deleted") {
          deleted++;
          deletedVersions++;
        }
      } catch (error) { warn("offsite version prune failed", key, error); }
    }
    if (rows.length < 200) break;
    cursor = rows[rows.length - 1]!.id;
  }

  const remove = async ({ key, size }: Pick<S3Object, "key" | "size">): Promise<boolean> => {
    try {
      // Expire the references together before removing their object. A database failure leaves the
      // copy available. A failed S3 delete leaves an expired object for the next listing to retry.
      // Keep its last uploaded size, including zero, so catch-up can distinguish expiry from a first upload.
      const data = { offsiteKey: null, offsiteUploadedAt: null, offsiteSize: String(size) };
      const outcome = await prisma.$transaction(async tx => {
        for (const receipt of plainReceipts.get(key) ?? []) await expireReceipt(tx, receipt);
        await tx.vpsBackupRecord.updateMany({ where: { offsiteKey: key, offsiteVersionId: null, offsiteDestination: destination }, data });
        return client.deleteObject(key);
      });
      if (outcome === "absent") return false;
      if (outcome === "hidden") hiddenCurrent++;
      deleted += 1;
      return true;
    } catch (err) {
      warn("offsite prune delete failed", key, err);
      return false;
    }
  };

  let newestRecovery: { key: string; at: number } | null = null;

  do {
    const page = await client.listObjects(prefix, 1000, token);
    token = page.nextContinuationToken;
    for (const obj of page.objects ?? []) {
      listed += 1;
      if (deleted >= maxDeletes) break;
      const lastModified = obj.lastModified ? new Date(obj.lastModified) : null;
      if (!lastModified || Number.isNaN(lastModified.getTime())) continue;
      try {
        assertDeletableObjectKey(obj.key);
        if (!obj.key.startsWith(prefix)) throw new Error("Object key outside the listed prefix");
      } catch (error) {
        warn("Skipping offsite object during retention", obj.key, error);
        continue;
      }
      const isRecovery = obj.key.startsWith(recoveryPrefix);
      if (isRecovery && (!newestRecovery || lastModified.getTime() > newestRecovery.at)) {
        newestRecovery = { key: obj.key, at: lastModified.getTime() };
      }
      if (lastModified >= cutoff) continue;
      if (protectedObjects.unversioned.has(obj.key) || protectedObjects.versions.has(obj.key) || versionedKeys.has(obj.key)) continue;
      if (isRecovery) {
        recovery.push({ key: obj.key, size: obj.size, at: lastModified.getTime() }); // decided below, once the newest bundle is known
        continue;
      }
      await remove(obj);
    }
    if (deleted >= maxDeletes) break;
  } while (token);

  for (const bundle of recovery) {
    if (deleted >= maxDeletes) break;
    if (bundle.key === newestRecovery?.key) continue;
    await remove(bundle);
  }

  logger.info("offsite prune finished", {
    listed,
    deleted, deletedVersions, hiddenCurrent,
    errors: errorCount,
    retentionDays,
    cutoff: cutoff.toISOString(),
  });

  return {
    enabled: true,
    listed,
    deleted, deletedVersions, hiddenCurrent,
    errors,
    retentionDays,
    cutoffIso: cutoff.toISOString(),
  };
}

/** The newest uploaded offsite object per backup type, and per server and type for VPS backups. */
async function newestOffsiteObjects(destination: string, receipts: Receipt[], unbound: string[]) {
  const latest = new Map<string, Receipt>();
  for (const receipt of receipts) {
    const prior = latest.get(receipt.type);
    if (!prior || receipt.uploadedAt > prior.uploadedAt || receipt.uploadedAt === prior.uploadedAt && receipt.id > prior.id) latest.set(receipt.type, receipt);
  }
  const [vps, legacy] = await Promise.all([
    prisma.vpsBackupRecord.findMany({
      where: { offsiteKey: { not: null }, offsiteDestination: destination },
      orderBy: [{ serverId: "asc" }, { backupType: "asc" }, { offsiteUploadedAt: "desc" }, { id: "desc" }],
      distinct: ["serverId", "backupType"],
      select: { offsiteKey: true, offsiteVersionId: true },
    }),
    prisma.vpsBackupRecord.findMany({ where: { offsiteKey: { not: null }, offsiteDestination: null }, select: { offsiteKey: true } }),
  ]);
  const unversioned = new Set([...unbound, ...legacy.flatMap(row => row.offsiteKey ? [row.offsiteKey] : [])]);
  const versions = new Map<string, Set<string>>();
  for (const { offsiteKey, offsiteVersionId } of [...vps, ...[...latest.values()].map((r) => ({ offsiteKey: r.key, offsiteVersionId: r.versionId }))]) {
    if (!offsiteKey) continue;
    if (!offsiteVersionId) { unversioned.add(offsiteKey); continue; }
    const kept = versions.get(offsiteKey) ?? new Set<string>();
    kept.add(offsiteVersionId);
    versions.set(offsiteKey, kept);
  }
  return { unversioned, versions };
}

