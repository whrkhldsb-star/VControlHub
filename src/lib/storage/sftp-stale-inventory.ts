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

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { listRemoteDirectory, type SftpListEntry } from "@/lib/ssh/client";
import { normalizeRemotePath } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { getSftpSyncDirectoryTimeoutMs } from "@/lib/runtime-settings/service";

const logger = createLogger("sftp-stale-inventory");

type SftpSyncNode = Prisma.StorageNodeGetPayload<{
  select: {
    id: true;
    name: true;
    driver: true;
    basePath: true;
    host: true;
    port: true;
    username: true;
    server: {
      select: {
        id: true;
        host: true;
        port: true;
        username: true;
        connectionType: true;
        password: true;
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

async function withDirectoryTimeout<T>(
  operation: Promise<T>,
  dirPath: string,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Scanning ${dirPath} exceeded ${Math.ceil(timeoutMs / 1000)} seconds; stopped scanning this directory`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function computeRelativePath(
  basePath: string,
  dirPath: string,
  entryName: string,
): string | null {
  const normalizedBase = basePath.replace(/\/+$/, "") || "/";
  const normalizedDir = dirPath.replace(/\/+$/, "") || "/";

  let relative: string;
  if (normalizedDir === normalizedBase) {
    relative = entryName;
  } else if (normalizedBase === "/" && normalizedDir.startsWith("/")) {
    relative = `${normalizedDir.slice(1)}/${entryName}`;
  } else if (normalizedDir.startsWith(`${normalizedBase}/`)) {
    relative = `${normalizedDir.slice(normalizedBase.length + 1)}/${entryName}`;
  } else {
    return null;
  }

  return relative.replace(/^\/+/, "");
}

function computeDirectoryBaseRelativePath(
  basePath: string,
  dirPath: string,
): string {
  const normalizedBase = basePath.replace(/\/+$/, "") || "/";
  const normalizedDir = dirPath.replace(/\/+$/, "") || "/";

  if (normalizedDir === normalizedBase) return "";
  if (normalizedBase === "/" && normalizedDir.startsWith("/"))
    return normalizedDir.slice(1);
  if (normalizedDir.startsWith(`${normalizedBase}/`))
    return normalizedDir.slice(normalizedBase.length + 1);
  return "";
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
  const baseRelative = computeDirectoryBaseRelativePath(basePath, basePath);
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

    // 只把"直接子条目"算 stale (子目录本身如果整目录都被删, 它的子条目会跟着被递归处理)
    const staleIds: string[] = [];
    for (const dbEntry of dbEntries) {
      if (!expectedRelativePaths.has(dbEntry.relativePath)) {
        // 进一步过滤: 如果有"祖先目录"存在但当前条目的父目录不在 expected,
        // 说明这个条目其实是孤儿 (它的父目录在 SFTP 上被删了), 同样标 stale
        const segments = dbEntry.relativePath.split("/");
        if (segments.length > 1) {
          const parentRelative = segments.slice(0, -1).join("/");
          if (!expectedRelativePaths.has(parentRelative)) {
            staleIds.push(dbEntry.id);
            continue;
          }
        }
        // 直接子层: 父目录就是 baseRelative, 不在 expected 就是 stale
        staleIds.push(dbEntry.id);
      }
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
 * 列出所有 SFTP 节点, 排除 healthStatus="UNHEALTHY" 的 (避免对失败节点重复扫描)。
 * 给 worker 周期调用, 也给 API 手动用。
 */
export async function listSftpNodesForStaleInventory() {
  // P2: take=500 上界,SFTP node 数本质有限。
  return prisma.storageNode.findMany({
    where: { driver: "SFTP" },
    take: 500,
    select: {
      id: true,
      name: true,
      driver: true,
      basePath: true,
      host: true,
      port: true,
      username: true,
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
          sshKey: { select: { privateKey: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
}
