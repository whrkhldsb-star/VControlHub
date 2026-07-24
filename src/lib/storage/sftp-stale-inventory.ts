/**
 * TR-005 T34a: SFTP 远端索引定期校验 (stale inventory).
 *
 * 跟 `sftp-sync.ts` 的 `syncSftpDirectoryEntries` 区别: 本模块是
 * **read-only** 远端扫描 + diff 出 DB 端的 stale 条目 + 软删除。
 * 不创建新条目, 不更新既有条目 (size / mtime 等)。
 *
 * 设计目标: 检测 "Hub 外被删除的 SFTP 文件仍保持 active" 这类残留,
 * 周期性给一个干净基线, 让 media stream / 分享链接 / 公开目录的
 * stale 引用减少。
 *
 * 复用 `sftp-sync.ts` 的 SSH 凭据解析 + `listRemoteDirectory` + 目录超时
 * 工具函数, 跟现有同步行为兼容, 失败模式 (凭据错 / 网络断) 一致。
 */
import { Prisma } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { listRemoteDirectory, type SftpListEntry } from "@/lib/ssh/client";
import { normalizeRemotePath } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { getSftpSyncDirectoryTimeoutMs } from "@/lib/runtime-settings/service";
import { computeDirectoryRelativePath, computeRelativePath, withDirectoryTimeout } from "@/lib/storage/sftp-walk-utils";

const logger = createLogger("sftp-stale-inventory");

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

const SFTP_STALE_INVENTORY_NODE_SELECT = {
  id: true,
  name: true,
  driver: true,
  basePath: true,
  host: true,
  port: true,
  username: true,
  hostKeySha256: true,
  healthStatus: true,
  lastHealthError: true,
  server: {
    select: {
      id: true,
      host: true,
      port: true,
      username: true,
      connectionType: true,
      password: true,
      hostKeySha256: true,
      sshKey: { select: { privateKey: true } },
    },
  },
} as const;

type SftpSyncNode = Prisma.StorageNodeGetPayload<{
  select: {
    id: true;
    name: true;
    driver: true;
    basePath: true;
    host: true;
    port: true;
    username: true;
    hostKeySha256: true;
    server: {
      select: {
        id: true;
        host: true;
        port: true;
        username: true;
        connectionType: true;
        password: true;
        hostKeySha256: true;
        sshKey: { select: { privateKey: true } };
      };
    };
  };
}>;

export interface SftpStaleInventoryResult {
  nodeId: string;
  nodeName: string;
  basePath: string;
  scanned: number;
  stale: number;
  errors: string[];
  durationMs: number;
  /** dryRun 模式下为 true, 没真正改 DB; 调用方可借此审计 */
  dryRun: boolean;
}

/**
 * 周期性扫描单个 SFTP 节点的远端索引, 标记 stale 条目。
 *
 * 行为保证 (跟 `sftp-sync.ts` 对齐):
 * - 凭据不可用 → 返 stale=0 + 1 条 error, 不 throw
 * - 单个目录超时 → 跳过该目录, 继续其它目录
 * - maxDepth 限制递归深度, 防止超深目录爆栈
 * - dryRun=true 时只 diff, 不写 DB
 *
 * 不 throw, 全部错误塞到 result.errors, 让 worker 能 completeJob 落档。
 */
export async function detectAndPruneSftpStaleInventory(input: {
  node: SftpSyncNode;
  maxDepth?: number;
  directoryTimeoutMs?: number;
  dryRun?: boolean;
}): Promise<SftpStaleInventoryResult> {
  const startedAt = Date.now();
  const { node } = input;
  const maxDepth = input.maxDepth ?? 5;
  const dryRun = input.dryRun ?? false;
  const result: Omit<SftpStaleInventoryResult, "durationMs"> = {
    nodeId: node.id,
    nodeName: node.name,
    basePath: node.basePath,
    scanned: 0,
    stale: 0,
    errors: [],
    dryRun,
  };

  if (node.driver !== "SFTP") {
    result.errors.push(`Node ${node.name} is not SFTP type; skipped`);
    return { ...result, durationMs: Date.now() - startedAt };
  }

  let credentials: ReturnType<typeof resolveStorageSshCredentials>;
  try {
    credentials = resolveStorageSshCredentials(node);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Connection credentials unavailable: ${msg}`);
    return { ...result, durationMs: Date.now() - startedAt };
  }

  const basePath = normalizeRemotePath(node.basePath);
  const directoryTimeoutMs =
    input.directoryTimeoutMs !== undefined
      ? Math.max(1, input.directoryTimeoutMs)
      : await getSftpSyncDirectoryTimeoutMs();

  const expectedRelativePaths = new Set<string>();
  const visitedDirs = new Set<string>();
  // Relative paths of directories whose listing completed successfully.
  // Empty string = node basePath. Only direct children of these dirs may be
  // treated as authoritative absence (avoids maxDepth / timeout false prunes).
  const listedDirRelatives = new Set<string>();

  async function walkDirectory(
    dirPath: string,
    currentDepth: number,
  ): Promise<void> {
    if (visitedDirs.has(dirPath)) return;
    visitedDirs.add(dirPath);

    let entries: SftpListEntry[];
    try {
      entries = await withDirectoryTimeout(
        listRemoteDirectory({
          host: credentials.host,
          port: credentials.port,
          username: credentials.username,
          privateKey: credentials.privateKey,
          password: credentials.password,
          hostKeySha256: credentials.hostKeySha256,
          remotePath: dirPath,
        }),
        dirPath,
        directoryTimeoutMs,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Scanning ${dirPath} failed: ${msg}`);
      return;
    }

    const dirRelative = computeDirectoryRelativePath(basePath, dirPath) ?? "";
    listedDirRelatives.add(dirRelative);

    for (const entry of entries) {
      if (entry.type === "other") continue;
      const relative = computeRelativePath(basePath, dirPath, entry.name);
      if (!relative) {
        result.errors.push(`Skipped entry outside basePath: ${dirPath}/${entry.name}`);
        continue;
      }
      expectedRelativePaths.add(relative);
      result.scanned += 1;
      if (
        entry.type === "directory" &&
        currentDepth < maxDepth
      ) {
        const subDir = `${dirPath.replace(/\/+$/, "")}/${entry.name}`;
        await walkDirectory(subDir, currentDepth + 1);
      }
    }
  }

  await walkDirectory(basePath, 0);

  // 跟 DB 端 diff: 找本节点下 isDeleted=false 但不在 expectedRelativePaths 的条目
  const baseRelative = computeDirectoryRelativePath(basePath, basePath) ?? "";
  try {
    // P2: take=10_000 上界。stale 检测需全集语义,单 node+目录前缀下 1w 行已是异常量级。
    const dbEntries = await prisma.fileEntry.findMany({
      where: {
        storageNodeId: node.id,
        isDeleted: false,
        ...(baseRelative
          ? { relativePath: { startsWith: `${baseRelative}/` } }
          : {}),
      },
      select: { id: true, relativePath: true },
      take: 10_000,
    });

    // Only prune direct children of directories we successfully listed.
    // Paths under unvisited subtrees (maxDepth boundary, list timeout/failure)
    // are not authoritative absences — leave them active.
    const staleIds: string[] = [];
    for (const dbEntry of dbEntries) {
      if (expectedRelativePaths.has(dbEntry.relativePath)) continue;

      const segments = dbEntry.relativePath.split("/");
      const parentRelative =
        segments.length > 1 ? segments.slice(0, -1).join("/") : "";
      // Parent must have been listed successfully (not merely observed as a name).
      if (!listedDirRelatives.has(parentRelative)) continue;

      // Direct child of a listed dir and missing from that listing → stale.
      staleIds.push(dbEntry.id);
    }

    result.stale = staleIds.length;

    if (staleIds.length > 0 && !dryRun) {
      const updateResult = await prisma.fileEntry.updateMany({
        where: { id: { in: staleIds } },
        data: { isDeleted: true },
      });
      logger.info("Pruned stale SFTP inventory", {
        nodeId: node.id,
        nodeName: node.name,
        stale: updateResult.count,
        scanned: result.scanned,
        dryRun,
      });
    } else if (staleIds.length > 0) {
      logger.info("Dry-run detected stale SFTP inventory", {
        nodeId: node.id,
        nodeName: node.name,
        stale: staleIds.length,
        scanned: result.scanned,
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`DB diff failed: ${msg}`);
  }

  return { ...result, durationMs: Date.now() - startedAt };
}

/**
 * 列出 SFTP 节点（给 worker 周期调用 + API 手动触发）。
 *
 * - 无 session：系统 worker / 已信任边界，跨租户全量（仅 driver 过滤）。
 * - 有 session：叠加 teamWhere，避免 storage_manager 触发跨团队扫描/凭据使用。
 *
 * 注：healthStatus=UNHEALTHY 的过滤在 job scanOneNode 里做，这里仍返回全量候选。
 */
export async function listSftpNodesForStaleInventory(
  session?: TeamSession | null,
) {
  // P2: take=500 上界,SFTP node 数本质有限。
  return prisma.storageNode.findMany({
    where: {
      driver: "SFTP",
      ...(session ? teamWhere(session) : {}),
    },
    take: 500,
    select: SFTP_STALE_INVENTORY_NODE_SELECT,
    orderBy: { name: "asc" },
  });
}

/**
 * 按 id 取单个 SFTP 节点。提供 session 时走 teamWhere，用于用户触发 API 的存在性/可见性检查。
 */
export async function findSftpNodeForStaleInventory(
  nodeId: string,
  session?: TeamSession | null,
) {
  return prisma.storageNode.findFirst({
    where: {
      id: nodeId,
      driver: "SFTP",
      ...(session ? teamWhere(session) : {}),
    },
    select: SFTP_STALE_INVENTORY_NODE_SELECT,
  });
}
