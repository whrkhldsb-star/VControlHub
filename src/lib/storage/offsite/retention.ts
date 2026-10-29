/**
 * Offsite (S3) retention: delete objects under pathPrefix older than retentionDays.
 * UI documents this as a lifecycle job; implement here so the setting is not dead.
 */
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { loadOffsiteConfig, validateOffsiteConfigForUse } from "./schema";
import { S3Client } from "./s3-client";

const logger = createLogger("offsite-retention");

export type OffsitePruneSummary = {
  enabled: boolean;
  skipped?: string;
  listed: number;
  deleted: number;
  errors: string[];
  retentionDays: number;
  cutoffIso: string;
};

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
      deleted: 0,
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
      deleted: 0,
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
  const protectedKeys = await newestOffsiteKeys();
  let listed = 0;
  let deleted = 0;
  const errors: string[] = [];
  let token: string | undefined;
  // Disaster-recovery bundles (recovery/) are uploaded by a script and have no database row, so they were pruned by
  // age alone - the last one included. The newest of them is kept like the newest copy of every other kind.
  const recoveryPrefix = `${prefix}recovery/`;
  const recovery: Array<{ key: string; at: number }> = [];

  const remove = async (key: string): Promise<boolean> => {
    try {
      await client.deleteObject(key);
      deleted += 1;
      // The records still said "offsite": the list kept the badge and the download fallback answered 404.
      await Promise.all([
        prisma.backupRecord.updateMany({ where: { offsiteKey: key }, data: { offsiteKey: null, offsiteUploadedAt: null } }),
        prisma.vpsBackupRecord.updateMany({ where: { offsiteKey: key }, data: { offsiteKey: null, offsiteUploadedAt: null } }),
      ]).catch((err) => logger.warn("offsite prune could not clear a record", { key, error: err instanceof Error ? err.message : String(err) }));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${key}: ${msg.slice(0, 200)}`);
      logger.warn("offsite prune delete failed", { key, error: msg });
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
      if (!obj.key) continue;
      const isRecovery = obj.key.startsWith(recoveryPrefix);
      if (isRecovery && (!newestRecovery || lastModified.getTime() > newestRecovery.at)) {
        newestRecovery = { key: obj.key, at: lastModified.getTime() };
      }
      if (lastModified >= cutoff) continue;
      if (protectedKeys.has(obj.key)) continue;
      if (isRecovery) {
        recovery.push({ key: obj.key, at: lastModified.getTime() }); // decided below, once the newest bundle is known
        continue;
      }
      await remove(obj.key);
    }
    if (deleted >= maxDeletes) break;
  } while (token);

  for (const bundle of recovery) {
    if (deleted >= maxDeletes) break;
    if (bundle.key === newestRecovery?.key) continue;
    await remove(bundle.key);
  }

  logger.info("offsite prune finished", {
    listed,
    deleted,
    errors: errors.length,
    retentionDays,
    cutoff: cutoff.toISOString(),
  });

  return {
    enabled: true,
    listed,
    deleted,
    errors: errors.slice(0, 20),
    retentionDays,
    cutoffIso: cutoff.toISOString(),
  };
}

/** The newest uploaded offsite object per backup type, and per server and type for VPS backups. */
async function newestOffsiteKeys(): Promise<Set<string>> {
  const [app, vps] = await Promise.all([
    prisma.backupRecord.findMany({
      where: { offsiteKey: { not: null } },
      orderBy: [{ type: "asc" }, { offsiteUploadedAt: "desc" }, { id: "desc" }],
      distinct: ["type"],
      select: { offsiteKey: true },
    }),
    prisma.vpsBackupRecord.findMany({
      where: { offsiteKey: { not: null } },
      orderBy: [{ serverId: "asc" }, { backupType: "asc" }, { offsiteUploadedAt: "desc" }, { id: "desc" }],
      distinct: ["serverId", "backupType"],
      select: { offsiteKey: true },
    }),
  ]);
  return new Set([...app, ...vps].map((row) => row.offsiteKey!).filter(Boolean));
}

