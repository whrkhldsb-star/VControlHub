/**
 * Offsite (S3) retention: delete objects under pathPrefix older than retentionDays.
 * UI documents this as a lifecycle job; implement here so the setting is not dead.
 */
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
  let listed = 0;
  let deleted = 0;
  const errors: string[] = [];
  let token: string | undefined;

  do {
    const page = await client.listObjects(prefix, 1000, token);
    token = page.nextContinuationToken;
    for (const obj of page.objects ?? []) {
      listed += 1;
      if (deleted >= maxDeletes) break;
      const lastModified = obj.lastModified ? new Date(obj.lastModified) : null;
      if (!lastModified || Number.isNaN(lastModified.getTime())) continue;
      if (lastModified >= cutoff) continue;
      if (!obj.key) continue;
      try {
        await client.deleteObject(obj.key);
        deleted += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${obj.key}: ${msg.slice(0, 200)}`);
        logger.warn("offsite prune delete failed", { key: obj.key, error: msg });
      }
    }
    if (deleted >= maxDeletes) break;
  } while (token);

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
