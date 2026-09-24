/**
 * TR-042: 系统配置导入服务 — 基础设施域导入模块。
 *
 * 包含 SSH 密钥、服务器、存储节点、用户存储访问的导入逻辑。
 * 从 import-executors.ts 按域拆分而来。
 */

import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import { parseBigInt, upsertById, upsertByIdWithSecondaryUnique, type Tx, type Counts } from "./import-executors-helpers";

// 6. SshKeys (fingerprint is a secondary unique key)
export async function importSshKeys(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  await upsertByIdWithSecondaryUnique(t.sshKeys, options, counts, {
    listExistingIds: async (ids) =>
      new Set(
        (await tx.sshKey.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
      ),
    listTakenSecondaryValues: async (values) =>
      new Set(
        (await tx.sshKey.findMany({ where: { fingerprint: { in: values } }, select: { fingerprint: true } })).map(
          (h) => h.fingerprint,
        ),
      ),
    secondaryValueOf: (r) => r.fingerprint || undefined,
    createManySkipDuplicates: async (rows) =>
      (
        await tx.sshKey.createMany({
          data: rows.map((r) => ({
            id: r.id,
            name: r.name,
            fingerprint: r.fingerprint,
            publicKey: r.publicKey,
            privateKey: r.privateKey,
            passphrase: r.passphrase,
            description: r.description,
            // Multi-tenant: preserve export teamId (null stays legacy-shared)
            teamId: r.teamId ?? null,
          })),
          skipDuplicates: true,
        })
      ).count,
    hasSecondaryClash: async (r) => {
      if (!r.fingerprint) return false;
      return Boolean(
        await tx.sshKey.findFirst({
          where: { fingerprint: r.fingerprint, NOT: { id: r.id } },
          select: { id: true },
        }),
      );
    },
    updateById: async (r) => {
      await tx.sshKey.update({
        where: { id: r.id },
        data: {
          name: r.name,
          fingerprint: r.fingerprint,
          publicKey: r.publicKey,
          // Full mode: restore private key + passphrase; Standard: keep existing
          ...(r.privateKey ? { privateKey: r.privateKey } : {}),
          ...(r.passphrase !== null && r.passphrase !== undefined
            ? { passphrase: r.passphrase }
            : {}),
          description: r.description,
          teamId: r.teamId ?? null,
        },
      });
    },
  });
}

// 7. Servers
export async function importServers(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  // Create carries the exported password verbatim (null in Standard mode);
  // update only replaces it when the export actually carries one.
  const toCreateData = (r: ExportFile["tables"]["servers"][number]) => ({
    id: r.id,
    name: r.name,
    host: r.host,
    port: r.port,
    username: r.username,
    sshKeyId: r.sshKeyId,
    // Full mode: restore actual password; Standard: null
    password: r.password,
    description: r.description,
    tags: r.tags,
    enabled: r.enabled,
    connectionType: r.connectionType as never,
    publicUrl: r.publicUrl,
    fileProxyPort: r.fileProxyPort,
    osDialect: r.osDialect,
    osInfo: r.osInfo,
    // Multi-tenant: preserve export teamId (null stays legacy-shared)
    teamId: r.teamId ?? null,
  });
  const toUpdateData = (r: ExportFile["tables"]["servers"][number]) => ({
    name: r.name,
    host: r.host,
    port: r.port,
    username: r.username,
    // Full mode: restore password; Standard: keep existing
    ...(r.password ? { password: r.password } : {}),
    sshKeyId: r.sshKeyId,
    description: r.description,
    tags: r.tags,
    enabled: r.enabled,
    connectionType: r.connectionType as never,
    publicUrl: r.publicUrl,
    fileProxyPort: r.fileProxyPort,
    osDialect: r.osDialect,
    osInfo: r.osInfo,
    teamId: r.teamId ?? null,
  });
  await upsertById(t.servers, options, counts, {
    listExistingIds: async (ids) =>
      new Set(
        (await tx.server.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
      ),
    createManySkipDuplicates: async (rows) =>
      (
        await tx.server.createMany({
          data: rows.map(toCreateData),
          skipDuplicates: true,
        })
      ).count,
    updateById: async (r) => {
      await tx.server.update({ where: { id: r.id }, data: toUpdateData(r) });
    },
  });
}

// 8. StorageNodes

/** After import, keep a single default storage node per teamId group (null = shared). */
async function normalizeStorageNodeDefaults(tx: Tx): Promise<void> {
  const defaults: Array<{ id: string; teamId: string | null; createdAt: Date }> = [];
  for (let skip = 0; ; skip += 500) {
    const page = await tx.storageNode.findMany({
      where: { isDefault: true },
      select: { id: true, teamId: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
      skip,
    });
    defaults.push(...page);
    if (page.length < 500) break;
  }
  const winners = new Map<string | null, string>();
  for (const row of defaults) {
    const key = row.teamId ?? null;
    if (!winners.has(key)) winners.set(key, row.id);
  }
  const winnerIds = new Set(winners.values());
  const demote = defaults.filter((d) => !winnerIds.has(d.id)).map((d) => d.id);
  if (demote.length > 0) {
    await tx.storageNode.updateMany({
      where: { id: { in: demote } },
      data: { isDefault: false },
    });
  }
}

export async function importStorageNodes(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.storageNodes;
  if (records.length === 0) return;

  const toData = (r: ExportFile["tables"]["storageNodes"][number]) => ({
    name: r.name,
    driver: r.driver as never,
    isDefault: r.isDefault,
    basePath: r.basePath,
    directAccessMode: r.directAccessMode as never,
    publicBaseUrl: r.publicBaseUrl,
    directAccessExpiresSeconds: r.directAccessExpiresSeconds,
    host: r.host,
    port: r.port,
    username: r.username,
    serverId: r.serverId,
    healthStatus: r.healthStatus,
    // Multi-tenant: preserve export teamId (null stays legacy-shared)
    teamId: r.teamId ?? null,
  });
  await upsertById(records, options, counts, {
    listExistingIds: async (ids) =>
      new Set(
        (await tx.storageNode.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
      ),
    createManySkipDuplicates: async (rows) =>
      (
        await tx.storageNode.createMany({
          data: rows.map((r) => ({ id: r.id, ...toData(r) })),
          skipDuplicates: true,
        })
      ).count,
    updateById: async (r) => {
      await tx.storageNode.update({ where: { id: r.id }, data: toData(r) });
    },
  });

  // Ensure at most one isDefault=true per team scope (null team = global/legacy pool).
  await normalizeStorageNodeDefaults(tx);
}

// 9. UserStorageAccess (FK try/catch on create → pre-filter FK validity)
export async function importUserStorageAccess(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.userStorageAccess;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.userStorageAccess.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.userStorageAccess.update({
        where: { id: r.id },
        data: {
          userId: r.userId,
          storageNodeId: r.storageNodeId,
          pathPrefix: r.pathPrefix,
          canRead: r.canRead,
          canWrite: r.canWrite,
          canDelete: r.canDelete,
          quotaBytes: parseBigInt(r.quotaBytes, "userStorageAccess.quotaBytes"),
          maxFileBytes: parseBigInt(r.maxFileBytes, "userStorageAccess.maxFileBytes"),
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }

  if (toCreate.length === 0) return;

  // Pre-filter FK validity (userId, storageNodeId) — original used try/catch per record
  const createUserIds = [...new Set(toCreate.map((r) => r.userId))];
  const createStorageNodeIds = [...new Set(toCreate.map((r) => r.storageNodeId))];
  const validUsers = await tx.user.findMany({
    where: { id: { in: createUserIds } },
    select: { id: true },
  });
  const validStorageNodes = await tx.storageNode.findMany({
    where: { id: { in: createStorageNodeIds } },
    select: { id: true },
  });
  const validUserIds = new Set(validUsers.map((u) => u.id));
  const validStorageNodeIds = new Set(validStorageNodes.map((s) => s.id));
  const validToCreate = toCreate.filter(
    (r) => validUserIds.has(r.userId) && validStorageNodeIds.has(r.storageNodeId),
  );
  // FK 不存在 → skip
  counts.skipped += toCreate.length - validToCreate.length;

  if (validToCreate.length > 0) {
    const result = await tx.userStorageAccess.createMany({
      data: validToCreate.map((r) => ({
        id: r.id,
        userId: r.userId,
        storageNodeId: r.storageNodeId,
        pathPrefix: r.pathPrefix,
        canRead: r.canRead,
        canWrite: r.canWrite,
        canDelete: r.canDelete,
        quotaBytes: parseBigInt(r.quotaBytes, "userStorageAccess.quotaBytes"),
        maxFileBytes: parseBigInt(r.maxFileBytes, "userStorageAccess.maxFileBytes"),
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
    counts.skipped += validToCreate.length - result.count;
  }
}
