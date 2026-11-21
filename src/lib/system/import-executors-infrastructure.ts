/**
 * TR-042: 系统配置导入服务 — 基础设施域导入模块。
 *
 * 包含 SSH 密钥、服务器、存储节点、用户存储访问的导入逻辑。
 * 从 import-executors.ts 按域拆分而来。
 */

import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { expandStorageBasePath, localBasePathBelongsToTenant, normalizeStorageEntryName, normalizeStorageTargetDirectory, tenantStorageBasePath } from "@/lib/storage/path-utils";
import { resetAgentForModeChange } from "@/lib/server/agent-service";
import { Prisma } from "@prisma/client";

import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import { byId, canBindServerKey, loadGrantUserScopes, loadImportReferences } from "./import-reference-scope";
import { loadStorageGrants, planStorageGrantImport } from "./import-resource-grants";
import { canBindStorageServer, loadStorageServers, planStorageNodes } from "./import-storage-servers";
import { creatorResolver, parseBigInt, parseDate, upsertById, upsertByIdWithSecondaryUnique, type Tx, type Counts } from "./import-executors-helpers";

// 6. SshKeys (fingerprint is a secondary unique key)
export async function importSshKeys(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const creator = await creatorResolver(tx, t.sshKeys.map((r) => r.createdById));
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
    secondaryValueOf: (r) => r.fingerprint,
    createManySkipDuplicates: async (rows) =>
      (
        await tx.sshKey.createMany({
          data: rows.map((r) => ({
            id: r.id,
            name: r.name,
            fingerprint: r.fingerprint,
            createdById: creator(r.createdById),
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
      return Boolean(
        await tx.sshKey.findFirst({
          where: { fingerprint: r.fingerprint, NOT: { id: r.id } },
          select: { id: true },
        }),
      );
    },
    updateById: async (r) => {
      await tx.sshKey.update({
        where: {
          id: r.id, teamId: r.teamId ?? null,
          ...(!r.privateKey ? { publicKey: r.publicKey, fingerprint: r.fingerprint } : {}),
        },
        data: {
          name: r.name,
          fingerprint: r.fingerprint,
          createdById: creator(r.createdById),
          publicKey: r.publicKey,
          // Full mode: restore private key + passphrase; Standard: keep existing
          ...(r.privateKey ? { privateKey: r.privateKey } : {}),
          ...(r.privateKey || (r.passphrase !== null && r.passphrase !== undefined)
            ? { passphrase: r.passphrase ?? null }
            : {}),
          description: r.description,
          teamId: r.teamId ?? null,
        },
      });
    },
  });
}

/**
 * The node's kind and profile beyond its SSH login. Fields a package does not
 * carry (exported before they were included) stay undefined, so Prisma keeps
 * the column default on create and the current value on update — a Windows or
 * Agent node is no longer silently recreated as a Linux DIRECT one.
 */
function serverProfileFields(r: ExportFile["tables"]["servers"][number]) {
  return {
    operatingSystem: r.operatingSystem,
    managementMode: r.managementMode,
    origin: r.origin,
    hostKeySha256: r.hostKeySha256,
    rdpDomain: r.rdpDomain,
    rdpPassword: r.rdpPassword,
    rdpIgnoreCertificate: r.rdpIgnoreCertificate,
    rdpCertificateSha256: r.rdpCertificateSha256,
    costAutoSync: r.costAutoSync,
    costMonthlyAmount: r.costMonthlyAmount === undefined ? undefined : r.costMonthlyAmount === null ? null : new Prisma.Decimal(r.costMonthlyAmount),
    costCurrency: r.costCurrency,
    costProvider: r.costProvider,
    expiresAt: r.expiresAt === undefined ? undefined : r.expiresAt === null ? null : parseDate(r.expiresAt, "servers.expiresAt"),
    trafficQuotaBytes: r.trafficQuotaBytes === undefined ? undefined : parseBigInt(r.trafficQuotaBytes, "servers.trafficQuotaBytes"),
    trafficQuotaMode: r.trafficQuotaMode,
    syncTargetAuth: r.syncTargetAuth,
  };
}

// 7. Servers
export async function importServers(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
  exportMode?: ExportFile["exportMode"],
): Promise<void> {
  // SSH keys were imported before: a key that is neither in the package nor
  // here (it belongs to another customer) cannot be linked.
  const keys = byId(await loadImportReferences(t.servers.flatMap((row) => row.sshKeyId ? [row.sshKeyId] : []),
    (ids) => tx.sshKey.findMany({ where: { id: { in: ids } }, select: { id: true, teamId: true } })));
  const importKey = (row: ExportFile["tables"]["servers"][number]) =>
    row.sshKeyId && canBindServerKey(row, keys.get(row.sshKeyId)) ? row.sshKeyId : null;
  // Create carries the exported password verbatim (null in Standard mode);
  // update only replaces it when the export actually carries one.
  const toCreateData = (r: ExportFile["tables"]["servers"][number]) => ({
    id: r.id,
    name: r.name,
    host: r.host,
    port: r.port,
    username: r.username,
    // Without its key the server is imported as one that still needs a key.
    sshKeyId: importKey(r),
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
    ...serverProfileFields(r),
  });
  const toUpdateData = (r: ExportFile["tables"]["servers"][number]) => ({
    name: r.name,
    host: r.host,
    port: r.port,
    username: r.username,
    // Full mode: restore password; Standard: keep existing
    ...(exportMode === "full" || r.password ? { password: r.password } : {}),
    description: r.description,
    tags: r.tags,
    enabled: r.enabled,
    connectionType: r.connectionType as never,
    publicUrl: r.publicUrl,
    fileProxyPort: r.fileProxyPort,
    osDialect: r.osDialect,
    osInfo: r.osInfo,
    teamId: r.teamId ?? null,
    ...serverProfileFields(r),
    // Standard mode carries no RDP password: keep the existing one.
    ...(exportMode === "full" || r.rdpPassword ? {} : { rdpPassword: undefined }),
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
      // Ownership changes must go through transferServerToCustomer, which
      // moves or refuses every dependent storage binding in its transaction.
      const current = await tx.server.findUniqueOrThrow({
        where: { id: r.id }, include: { sshKey: { select: { teamId: true } } },
      });
      const changed = current.host !== r.host || current.port !== r.port ||
        (r.managementMode !== undefined && r.managementMode !== current.managementMode) ||
        (r.operatingSystem !== undefined && r.operatingSystem !== current.operatingSystem);
      const loginChanged = changed || current.username !== r.username ||
        current.connectionType !== r.connectionType ||
        (r.rdpDomain !== undefined && r.rdpDomain !== current.rdpDomain) ||
        (r.rdpCertificateSha256 !== undefined && r.rdpCertificateSha256 !== current.rdpCertificateSha256) ||
        (r.hostKeySha256 !== undefined && r.hostKeySha256 !== current.hostKeySha256);
      const requestedKey = importKey(r);
      const retainedKey = !loginChanged && r.sshKeyId && canBindServerKey(r, current.sshKey ?? undefined)
        ? current.sshKeyId : null;
      await tx.server.update({
        where: { id: r.id, teamId: r.teamId ?? null, updatedAt: current.updatedAt },
        data: { ...toUpdateData(r), sshKeyId: requestedKey ?? retainedKey, ...(loginChanged ? {
          password: r.password ?? null, rdpPassword: r.rdpPassword ?? null,
        } : {}), ...(changed ? {
          ...resetAgentForModeChange(), onboardingStatus: "NEEDS_ATTENTION", onboardingLastError: null,
        } : {}) },
      });
    },
  });
}

// 8. StorageNodes

/** A source installation may have a different STORAGE_ROOT. Only carry the
 * suffix of its teams/<customer> namespace into the local customer root. */
export function alignStorageNodeCustomer(node: ExportFile["tables"]["storageNodes"][number], teamId: typeof node.teamId) {
  if (node.teamId === teamId || node.driver !== "LOCAL" || !node.teamId || !teamId) return { ...node, teamId };
  const invalidRoot = () => new ValidationError(t("backend.system.importLocalRootConflict", { id: node.id }));
  if (!normalizeStorageEntryName(node.teamId).ok || !normalizeStorageEntryName(teamId).ok) throw invalidRoot();
  // Older packages have no source STORAGE_ROOT. Recognise the local configuration
  // and the shipped relative/production layouts, including unexpanded deployment placeholders.
  const portable = (value: string) => expandStorageBasePath(value).replace(/\\/g, "/").replace(/^\.\//, "");
  const imported = portable(node.basePath);
  const sourceRoots = [tenantStorageBasePath(node.teamId), tenantStorageBasePath(node.teamId, "storage"),
    tenantStorageBasePath(node.teamId, "/var/lib/vcontrolhub/storage"),
    tenantStorageBasePath(node.teamId, "/var/lib/${APP_SLUG:-vcontrolhub}/storage")].map(portable);
  const sourceRoot = sourceRoots.find((root) => imported === root || imported.startsWith(`${root}/`));
  if (!sourceRoot || imported.split("/").includes("..")) throw invalidRoot();
  const suffix = normalizeStorageTargetDirectory(imported.slice(sourceRoot.length + 1));
  if (!suffix.ok) throw invalidRoot();
  const root = tenantStorageBasePath(teamId);
  const basePath = suffix.path ? `${root}/${suffix.path}` : root;
  if (!localBasePathBelongsToTenant(basePath, teamId)) throw invalidRoot();
  return { ...node, teamId, basePath };
}

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

  type NodeRow = ExportFile["tables"]["storageNodes"][number];
  const servers = await loadStorageServers(tx, records);

  const { existing, plan, binding } = await planStorageNodes(tx, records, options.overwriteExisting, servers);
  counts.skipped += records.length - plan.length;

  // Only the server association travels with an Agent drive. Pairing credentials are local.
  async function restoreFileShare(r: NodeRow) {
    if (!r.serverId) return;
    const server = servers.get(r.serverId);
    if (canBindStorageServer(r, server)) {
      await tx.agentFileShare.create({ data: { storageNodeId: r.id, serverId: r.serverId, teamId: r.teamId ?? null } });
    }
  }
  const toData = (r: NodeRow) => ({
    name: r.name,
    driver: r.driver as never,
    isDefault: r.isDefault,
    basePath: r.driver === "AGENT" ? "/" : r.basePath,
    directAccessMode: (r.driver === "AGENT" ? "PROXY" : r.directAccessMode) as never,
    publicBaseUrl: r.driver === "AGENT" ? null : r.publicBaseUrl,
    directAccessExpiresSeconds: r.directAccessExpiresSeconds,
    host: r.host,
    port: r.port,
    username: r.username,
    ...(binding(r) === undefined ? {} : { serverId: binding(r) }),
    healthStatus: r.driver === "AGENT" ? "UNKNOWN" as const : r.healthStatus,
    ...(r.driver === "AGENT" ? { lastHealthyAt: null, lastHealthyTransport: null, lastHealthCheckAt: null, lastHealthError: null, lastHealthLatencyMs: null } : {}),
    // Multi-tenant: preserve export teamId (null stays legacy-shared)
    teamId: r.teamId ?? null,
    hostKeySha256: r.hostKeySha256,
    // Standard exports carry no WebDAV credentials: keep what is here.
    ...(r.webdavConfigEncrypted ? { webdavConfigEncrypted: r.webdavConfigEncrypted } : {}),
  });
  await upsertById(plan.map(({ row }) => row), options, counts, {
    listExistingIds: async () => new Set(existing.keys()),
    createManySkipDuplicates: async (rows) => {
      const direct = rows.filter((row) => row.driver !== "AGENT");
      let created = direct.length ? (await tx.storageNode.createMany({
        data: direct.map((r) => ({ id: r.id, ...toData(r) })), skipDuplicates: true,
      })).count : 0;
      for (const r of rows.filter((row) => row.driver === "AGENT")) {
        const result = await tx.storageNode.createMany({ data: { id: r.id, ...toData(r) }, skipDuplicates: true });
        if (result.count) {
          await restoreFileShare(r);
          created++;
        }
      }
      return created;
    },
    updateById: async (r) => {
      const current = await tx.storageNode.findUniqueOrThrow({ where: { id: r.id } });
      const sameEndpoint = current.teamId === (r.teamId ?? null) && current.driver === r.driver &&
        current.basePath === r.basePath && current.host === r.host && current.port === r.port &&
        current.username === r.username && current.serverId === (r.serverId ?? null);
      await tx.storageNode.update({ where: { id: r.id, teamId: r.teamId ?? null, updatedAt: current.updatedAt }, data: {
        ...toData(r), ...(!sameEndpoint && !r.webdavConfigEncrypted ? { webdavConfigEncrypted: null } : {}),
      } });
      if (!sameEndpoint || r.driver === "AGENT" || r.webdavConfigEncrypted) await tx.shareLink.updateMany({ where: { storageNodeId: r.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.agentFileShare.deleteMany({ where: { storageNodeId: r.id } });
      if (r.driver === "AGENT") await restoreFileShare(r);
    },
  });

  // Ensure at most one isDefault=true per team scope (null team = global/legacy pool).
  await normalizeStorageNodeDefaults(tx);
}

// 9. UserStorageAccess
export async function importUserStorageAccess(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.userStorageAccess;
  if (records.length === 0) return;
  const [existing, users, nodes] = await Promise.all([
    loadStorageGrants(tx, records),
    loadGrantUserScopes(tx, records.map((row) => row.userId)),
    loadImportReferences(records.map((row) => row.storageNodeId), (ids) => tx.storageNode.findMany({
      where: { id: { in: ids } }, select: { id: true, teamId: true },
    })).then(byId),
  ]);
  const plan = planStorageGrantImport(records, existing, options, users, nodes);
  const creates: Prisma.UserStorageAccessCreateManyInput[] = [];
  for (const { row, action } of plan) {
    const data = {
      userId: row.userId,
      storageNodeId: row.storageNodeId,
      pathPrefix: row.pathPrefix,
      canRead: row.canRead,
      canWrite: row.canWrite,
      canDelete: row.canDelete,
      quotaBytes: parseBigInt(row.quotaBytes, "userStorageAccess.quotaBytes"),
      maxFileBytes: parseBigInt(row.maxFileBytes, "userStorageAccess.maxFileBytes"),
    };
    if (action === "create") {
      creates.push({ id: row.id, ...data });
    } else {
      await tx.userStorageAccess.update({ where: { id: row.id }, data });
      counts.updated += 1;
    }
  }
  if (creates.length > 0) {
    const result = await tx.userStorageAccess.createMany({ data: creates, skipDuplicates: true });
    counts.created += result.count;
    counts.skipped += creates.length - result.count;
  }
  counts.skipped += records.length - plan.length;
}
