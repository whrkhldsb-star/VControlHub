/**
 * TR-042: 系统配置导入服务 — 基础设施域导入模块。
 *
 * 包含 SSH 密钥、服务器、存储节点、用户存储访问的导入逻辑。
 * 从 import-executors.ts 按域拆分而来。
 */

import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import { parseBigInt } from "./import-executors-helpers";
import type { Tx, Counts } from "./import-executors-helpers";

// 6. SshKeys
export async function importSshKeys(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.sshKeys;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.sshKey.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.sshKey.createMany({
      data: toCreate.map((r) => ({
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
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
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
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 7. Servers
export async function importServers(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.servers;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.server.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.server.createMany({
      data: toCreate.map((r) => ({
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
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.server.update({
        where: { id: r.id },
        data: {
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
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 8. StorageNodes
export async function importStorageNodes(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.storageNodes;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.storageNode.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.storageNode.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
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
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.storageNode.update({
        where: { id: r.id },
        data: {
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
          teamId: r.teamId ?? null,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
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
          quotaBytes: parseBigInt(r.quotaBytes),
          maxFileBytes: parseBigInt(r.maxFileBytes),
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
        quotaBytes: parseBigInt(r.quotaBytes),
        maxFileBytes: parseBigInt(r.maxFileBytes),
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
    counts.skipped += validToCreate.length - result.count;
  }
}
