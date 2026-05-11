import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { auditUserAction } from "@/lib/audit/service";
import {
  ensureAria2Daemon,
  addUri,
  removeDownload,
  pauseDownload,
  unpauseDownload,
  tellActive,
  tellWaiting,
  tellStatus,
  getGlobalStat,
  changeOption,
  changeGlobalOption,
  formatBytes,
  formatSpeed,
  computeProgress,
  type Aria2Status,
} from "@/lib/aria2/service";
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { resolveDownloadTargetPath } from "@/lib/downloads/target-path";
import { validateDownloadSourceUrl } from "@/lib/downloads/source-url";

function normalizeDownloadFileName(fileName: string | null | undefined): string | null {
  const value = (fileName ?? "").trim();
  if (!value) return null;
  if (value.includes("\0") || value.includes("/") || value.includes("\\")) {
    throw new Error("下载文件名不能包含路径分隔符");
  }
  if (value === "." || value === ".." || value.includes("..")) {
    throw new Error("下载文件名不能包含 ..");
  }
  if (/^[A-Za-z]:/.test(value) || /[\r\n]/.test(value)) {
    throw new Error("下载文件名无效");
  }
  return value;
}

function relativePathFromDownloadTarget(basePath: string | null | undefined, targetPath: string, fileName: string): string | null {
  const base = resolveDownloadTargetPath(basePath, "");
  const fullPath = toRemoteChildPath(targetPath, fileName);
  const relative = path.posix.relative(base, fullPath);
  if (!relative || relative.startsWith("..") || path.posix.isAbsolute(relative)) {
    return null;
  }
  return relative;
}

async function indexDownloadedFileEntry(input: {
  storageNode: { id: string; basePath: string | null } | null | undefined;
  targetPath: string;
  fileName: string | null | undefined;
  size: number | bigint | null | undefined;
}) {
  const safeFileName = normalizeDownloadFileName(input.fileName);
  if (!input.storageNode?.id || !safeFileName) return;

  const relativePath = relativePathFromDownloadTarget(input.storageNode.basePath, input.targetPath, safeFileName);
  if (!relativePath) return;

  const existingEntry = await prisma.fileEntry.findFirst({
    where: { storageNodeId: input.storageNode.id, relativePath },
    select: { id: true },
  });
  const data = {
    storageNodeId: input.storageNode.id,
    name: safeFileName,
    entryType: "FILE" as const,
    relativePath,
    size: input.size == null ? null : BigInt(input.size),
    isDeleted: false,
  };

  if (existingEntry) {
    await prisma.fileEntry.update({
      where: { id: existingEntry.id },
      data: {
        name: data.name,
        entryType: data.entryType,
        size: data.size,
        isDeleted: false,
      },
    });
  } else {
    await prisma.fileEntry.create({ data });
  }
}

import {
  buildDirectDownloadCommand,
  getDirectDownloadLogCommand,
  shellQuote,
  toRemoteChildPath,
  toScpTarget,
} from "@/lib/downloads/remote-command";

const execFileAsync = promisify(execFile);

function getPublicDownloadError(error: unknown): string {
  if (
    error instanceof Error &&
    error.message.includes("No SSH key or password")
  ) {
    return "目标 VPS 未配置可用的 SSH 凭据";
  }
  return "下载任务执行失败，请查看服务日志";
}

export const dynamic = "force-dynamic";

/* ── Helpers ──────────────────────────────────────────────── */

function isMagnetLink(url: string): boolean {
  return url.startsWith("magnet:?");
}

/** Map aria2 status to our DownloadTaskStatus */
function mapAria2Status(s: string): string {
  switch (s) {
    case "active":
      return "RUNNING";
    case "waiting":
      return "PENDING";
    case "paused":
      return "PENDING";
    case "error":
      return "FAILED";
    case "complete":
      return "COMPLETED";
    case "removed":
      return "CANCELLED";
    default:
      return "PENDING";
  }
}

/** Build a progress string from aria2 status */
function buildProgressText(st: Aria2Status): string {
  const pct = computeProgress(st.completedLength, st.totalLength);
  const speed = formatSpeed(st.downloadSpeed);
  const completed = formatBytes(st.completedLength);
  const total = formatBytes(st.totalLength);
  const name =
    st.bittorrent?.info?.name ||
    (st.files?.[0]?.path ? path.basename(st.files[0].path) : "");
  if (st.status === "active") {
    return `${pct}% · ${speed} · ${completed}/${total}${name ? ` · ${name}` : ""}`;
  }
  if (st.status === "complete") {
    return `完成 · ${total}${name ? ` · ${name}` : ""}`;
  }
  if (st.status === "error") {
    return `失败 · ${completed}/${total}`;
  }
  return `${pct}% · ${completed}/${total}`;
}

/* ── POST: Create download task ───────────────────────────── */

export async function POST(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "storage:write")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      url,
      serverId,
      targetPath,
      fileName,
      category,
      maxSpeedKb,
      isBatch,
      batchUrls,
    } = body as {
      url: string;
      serverId: string;
      targetPath: string;
      fileName?: string;
      category?: string;
      maxSpeedKb?: number;
      isBatch?: boolean;
      batchUrls?: string[];
    };

    if (!url || !serverId || !targetPath) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }

    const allUrls = isBatch && batchUrls?.length ? batchUrls : [url];
    for (const u of allUrls) {
      const validation = validateDownloadSourceUrl(u);
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.reason },
          { status: 400 },
        );
      }
    }

    const server = await prisma.server.findUnique({
      where: { id: serverId },
      include: { sshKey: true, storageNode: true },
    });
    if (!server)
      return NextResponse.json({ error: "VPS 节点不存在" }, { status: 404 });
    if (!server.storageNode) {
      return NextResponse.json(
        { error: "该 VPS 未绑定存储节点，无法创建下载任务" },
        { status: 400 },
      );
    }
    if (!server.sshKey && !server.password)
      return NextResponse.json(
        { error: "该 VPS 未配置 SSH 密钥或密码" },
        { status: 400 },
      );

    let resolvedTargetPath: string;
    try {
      resolvedTargetPath = resolveDownloadTargetPath(
        server.storageNode.basePath,
        targetPath,
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "下载目标路径无效" },
        { status: 400 },
      );
    }

    let safeFileName: string | null;
    try {
      safeFileName = normalizeDownloadFileName(fileName);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "下载文件名无效" },
        { status: 400 },
      );
    }

    const relayMode = allUrls.some(isMagnetLink);

    // Create task record
    const task = await prisma.downloadTask.create({
      data: {
        url,
        serverId,
        targetPath: resolvedTargetPath,
        fileName: safeFileName,
        status: "PENDING",
        progress: relayMode ? "准备中转下载..." : "准备远程下载...",
        relayMode,
        createdBy: session.userId,
        category: category || null,
        maxSpeedKb: maxSpeedKb || null,
        isBatch: isBatch ?? false,
        batchUrls:
          isBatch && batchUrls?.length
            ? JSON.stringify(batchUrls)
            : JSON.stringify([]),
      },
    });

    const serverForExec = {
      host: server.host,
      port: server.port,
      username: server.username,
      sshKeyId: server.sshKeyId,
      password: server.password,
      storageNode: server.storageNode
        ? { id: server.storageNode.id, basePath: server.storageNode.basePath }
        : null,
      sshKey: server.sshKey
        ? { privateKey: server.sshKey.privateKey ?? "" }
        : null,
    };

    // Execute asynchronously
    if (relayMode) {
      executeAria2RelayDownload(
        task.id,
        serverForExec,
        allUrls,
        resolvedTargetPath,
        safeFileName,
        maxSpeedKb,
      ).catch((error) => {
        logError("[DownloadAPI] Relay execution error:", error);
      });
    } else {
      executeDirectDownload(
        task.id,
        serverForExec,
        allUrls[0],
        resolvedTargetPath,
        safeFileName,
      ).catch((error) => {
        logError("[DownloadAPI] Direct execution error:", error);
      });
    }

    auditUserAction(session.userId, "download.create", {
      url,
      serverId,
      targetPath: resolvedTargetPath,
      taskId: task.id,
      relayMode: relayMode ?? false,
      category: category ?? "",
      isBatch: isBatch ?? false,
    });

    return NextResponse.json({ success: true, taskId: task.id, relayMode });
  } catch (error) {
    logError("[DownloadAPI] Create error:", error);
    return NextResponse.json({ error: "创建下载任务失败" }, { status: 500 });
  }
}

/* ── GET: List tasks with real-time aria2 progress ────────── */

export async function GET(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "storage:read")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const serverId = searchParams.get("serverId");
  const category = searchParams.get("category");

  const where: Record<string, unknown> = {};
  if (serverId) where.serverId = serverId;
  if (category) where.category = category;

  const tasks = await prisma.downloadTask.findMany({
    where,
    include: {
      server: { select: { id: true, name: true, host: true } },
      creator: { select: { id: true, username: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Try to refresh aria2-based tasks with live progress
  try {
    await ensureAria2Daemon();
    const activeGids = new Map<string, string>();
    for (const t of tasks) {
      if (t.aria2Gid && t.status === "RUNNING") {
        activeGids.set(t.aria2Gid, t.id);
      }
    }
    if (activeGids.size > 0) {
      const [activeList, waitingList] = await Promise.all([
        tellActive(),
        tellWaiting(),
      ]);
      const allAria2 = [...activeList, ...waitingList];
      const updates: Promise<unknown>[] = [];
      for (const a of allAria2) {
        const taskId = activeGids.get(a.gid);
        if (taskId) {
          const progress = buildProgressText(a);
          updates.push(
            prisma.downloadTask.update({
              where: { id: taskId },
              data: {
                progress,
                completedBytes: a.completedLength,
                totalBytes: a.totalLength,
                downloadSpeed: a.downloadSpeed,
              },
            }),
          );
        }
      }
      await Promise.all(updates);
    }
  } catch {
    // aria2 not available, return DB data as-is
  }

  const safe = tasks.map((t) => ({
    ...t,
    pid: t.pid ?? null,
    aria2Gid: t.aria2Gid ?? null,
    category: t.category ?? null,
    maxSpeedKb: t.maxSpeedKb ?? null,
    totalBytes: t.totalBytes ?? null,
    completedBytes: t.completedBytes ?? null,
    downloadSpeed: t.downloadSpeed ?? null,
    fileSize: t.fileSize ?? null,
    isBatch: t.isBatch ?? false,
    batchUrls: t.batchUrls ?? null,
  }));

  // Also return aria2 global stats
  let globalStat = null;
  try {
    globalStat = await getGlobalStat();
  } catch {}

  return NextResponse.json({ tasks: safe, globalStat });
}

/* ── PATCH: Control tasks (pause/resume/speed limit/refresh) */

export async function PATCH(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "storage:write")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { taskId, action, maxSpeedKb, globalMaxSpeedKb } = body as {
      taskId?: string;
      action?: "pause" | "resume" | "refresh";
      maxSpeedKb?: number;
      globalMaxSpeedKb?: number;
    };

    // Global speed limit
    if (globalMaxSpeedKb !== undefined) {
      try {
        await ensureAria2Daemon();
        await changeGlobalOption({
          "max-overall-download-limit": `${globalMaxSpeedKb}K`,
        });
        return NextResponse.json({ success: true });
      } catch {
        return NextResponse.json(
          { error: "设置全局限速失败" },
          { status: 500 },
        );
      }
    }

    if (!taskId)
      return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });

    const task = await prisma.downloadTask.findUnique({
      where: { id: taskId },
    });
    if (!task)
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });

    // Per-task speed limit
    if (maxSpeedKb !== undefined && task.aria2Gid) {
      try {
        await ensureAria2Daemon();
        await changeOption(task.aria2Gid, {
          "max-download-limit": `${maxSpeedKb}K`,
        });
        await prisma.downloadTask.update({
          where: { id: taskId },
          data: { maxSpeedKb },
        });
        return NextResponse.json({ success: true });
      } catch {
        return NextResponse.json({ error: "设置限速失败" }, { status: 500 });
      }
    }

    if (action === "pause" && task.aria2Gid) {
      try {
        await pauseDownload(task.aria2Gid);
      } catch {}
      await prisma.downloadTask.update({
        where: { id: taskId },
        data: { status: "PENDING", progress: "已暂停" },
      });
      return NextResponse.json({ success: true });
    }

    if (action === "resume" && task.aria2Gid) {
      try {
        await unpauseDownload(task.aria2Gid);
      } catch {}
      await prisma.downloadTask.update({
        where: { id: taskId },
        data: { status: "RUNNING", progress: "恢复下载..." },
      });
      return NextResponse.json({ success: true });
    }

    // Refresh: just re-fetch and return
    if (action === "refresh" && task.aria2Gid) {
      try {
        await ensureAria2Daemon();
        const st = await tellStatus(task.aria2Gid);
        const progress = buildProgressText(st);
        const newStatus = mapAria2Status(st.status) as
          | "RUNNING"
          | "COMPLETED"
          | "FAILED"
          | "CANCELLED"
          | "PENDING";
        await prisma.downloadTask.update({
          where: { id: taskId },
          data: {
            status: newStatus,
            progress,
            completedBytes: st.completedLength,
            totalBytes: st.totalLength,
            downloadSpeed: st.downloadSpeed,
          },
        });
        return NextResponse.json({ status: newStatus, progress });
      } catch {
        return NextResponse.json({
          status: task.status,
          progress: task.progress,
        });
      }
    }

    // Non-aria2 refresh (legacy)
    if (action === "refresh") {
      return NextResponse.json({
        status: task.status,
        progress: task.progress,
      });
    }

    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (error) {
    logError("[DownloadAPI] Patch error:", error);
    return NextResponse.json({ error: "操作失败" }, { status: 500 });
  }
}

/* ── DELETE: Cancel task ──────────────────────────────────── */

export async function DELETE(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "storage:write")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    if (!taskId)
      return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });

    const task = await prisma.downloadTask.findUnique({
      where: { id: taskId },
      include: { server: { include: { sshKey: true } } },
    });
    if (!task)
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });

    // Cancel aria2 download if applicable
    if (task.aria2Gid) {
      try {
        await removeDownload(task.aria2Gid, true);
      } catch {}
    }

    // Kill legacy processes
    if (task.status === "RUNNING") {
      if (task.relayMode) {
        if (task.pid) {
          try {
            process.kill(task.pid, "SIGTERM");
          } catch {}
        }
        const tempDir = `/tmp/app-relay-${taskId}`;
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {}
      } else if (task.pid) {
        try {
          const sshParams = await buildSshParamsFromServer(
            task.server,
            task.server.sshKey,
          );
          await execRemoteCommand({
            ...sshParams,
            command: `kill ${task.pid} 2>/dev/null; rm -f -- ${shellQuote(`/tmp/app-dl-${task.id}.pid`)}`,
            timeout: 10000,
          });
        } catch {}
      }
    }

    await prisma.downloadTask.update({
      where: { id: taskId },
      data: { status: "CANCELLED", errorMessage: "用户取消" },
    });

    auditUserAction(session.userId, "download.cancel", {
      taskId,
      url: task.url,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("[DownloadAPI] Cancel error:", error);
    return NextResponse.json({ error: "取消任务失败" }, { status: 500 });
  }
}

/* ── Aria2 relay download (magnet/batch) ──────────────────── */

async function executeAria2RelayDownload(
  taskId: string,
  server: {
    host: string;
    port: number;
    username: string;
    sshKeyId: string | null;
    password: string | null;
    storageNode?: { id: string; basePath: string | null } | null;
    sshKey?: { privateKey: string } | null;
  },
  urls: string[],
  targetPath: string,
  _fileName?: string | null,
  maxSpeedKb?: number | null,
) {
  void _fileName;
  const tempDir = `/tmp/app-relay-${taskId}`;

  try {
    await ensureAria2Daemon();
    await fs.mkdir(tempDir, { recursive: true });

    // Add download to aria2 via RPC
    const options: Record<string, string> = {
      dir: tempDir,
      "seed-time": "0",
    };
    if (maxSpeedKb) options["max-download-limit"] = `${maxSpeedKb}K`;

    const gid = await addUri(urls, options);

    // Save aria2 GID to DB
    await prisma.downloadTask.update({
      where: { id: taskId },
      data: {
        aria2Gid: gid,
        status: "RUNNING",
        progress: "中转下载中（aria2 RPC）...",
      },
    });

    // Poll aria2 for completion
    let done = false;
    let elapsed = 0;
    const maxWait = 7200; // 2 hours max

    while (!done && elapsed < maxWait) {
      await new Promise((r) => setTimeout(r, 5000));
      elapsed += 5;

      try {
        const st = await tellStatus(gid);
        const progress = buildProgressText(st);
        await prisma.downloadTask.update({
          where: { id: taskId },
          data: {
            progress,
            completedBytes: st.completedLength,
            totalBytes: st.totalLength,
            downloadSpeed: st.downloadSpeed,
          },
        });

        if (st.status === "complete") {
          done = true;
        } else if (st.status === "error" || st.status === "removed") {
          await prisma.downloadTask.update({
            where: { id: taskId },
            data: {
              status: "FAILED",
              errorMessage: `aria2 下载失败: ${st.status}`,
            },
          });
          await cleanupTemp(tempDir);
          return;
        }
      } catch {
        // aria2 might have purged the result; check if files exist
        try {
          const files = await fs.readdir(tempDir);
          if (files.some((f) => !f.endsWith(".aria2"))) {
            done = true;
          }
        } catch {}
      }
    }

    if (!done) {
      try {
        await removeDownload(gid, true);
      } catch {}
      await prisma.downloadTask.update({
        where: { id: taskId },
        data: { status: "FAILED", errorMessage: "下载超时（2小时限制）" },
      });
      await cleanupTemp(tempDir);
      return;
    }

    // Phase 2: SFTP transfer to target VPS
    await prisma.downloadTask.update({
      where: { id: taskId },
      data: { progress: "下载完成，正在传输到目标 VPS..." },
    });

    const downloadedFiles = await fs.readdir(tempDir);
    const filesToTransfer = downloadedFiles.filter(
      (f) => !f.endsWith(".aria2") && !f.startsWith("."),
    );

    if (filesToTransfer.length === 0) {
      await prisma.downloadTask.update({
        where: { id: taskId },
        data: { status: "FAILED", errorMessage: "下载完成但未找到文件" },
      });
      await cleanupTemp(tempDir);
      return;
    }

    // Calculate total file size
    let totalSize = 0;
    for (const f of filesToTransfer) {
      try {
        const stat = await fs.stat(path.join(tempDir, f));
        totalSize += stat.size;
      } catch {}
    }

    const sshParams = await buildSshParamsFromServer(server, server.sshKey);
    await execRemoteCommand({
      ...sshParams,
      command: `mkdir -p -- ${shellQuote(targetPath)}`,
      timeout: 15000,
    });

    for (const file of filesToTransfer) {
      const localFilePath = path.join(tempDir, file);
      const remoteFilePath = toRemoteChildPath(targetPath, file);
      await transferFileViaSsh2(server, localFilePath, remoteFilePath, taskId);
    }

    // Phase 3: Update + cleanup
    if (filesToTransfer.length === 1) {
      await indexDownloadedFileEntry({
        storageNode: server.storageNode,
        targetPath,
        fileName: filesToTransfer[0],
        size: totalSize,
      });
    }

    await prisma.downloadTask.update({
      where: { id: taskId },
      data: {
        status: "COMPLETED",
        progress: "下载并传输完成",
        fileSize: String(totalSize),
        totalBytes: String(totalSize),
        completedBytes: String(totalSize),
      },
    });

    await cleanupTemp(tempDir);

  } catch (error) {
    logError("[DownloadAPI] Relay download execution failed:", error);
    try {
      await prisma.downloadTask.update({
        where: { id: taskId },
        data: {
          status: "FAILED",
          errorMessage: getPublicDownloadError(error),
        },
      });
    } catch {}
    await cleanupTemp(tempDir);
  }
}

/** Direct download (HTTP/HTTPS) on remote VPS — same as before */
async function executeDirectDownload(
  taskId: string,
  server: {
    host: string;
    port: number;
    username: string;
    sshKeyId: string | null;
    password: string | null;
    storageNode?: { id: string; basePath: string | null } | null;
    sshKey?: { privateKey: string } | null;
  },
  url: string,
  targetPath: string,
  fileName?: string | null,
) {
  try {
    const sshParams = await buildSshParamsFromServer(server, server.sshKey);
    await execRemoteCommand({
      ...sshParams,
      command: `mkdir -p -- ${shellQuote(targetPath)}`,
      timeout: 15000,
    });

    const downloadCmd = buildDirectDownloadCommand({
      taskId,
      url,
      targetPath,
      fileName,
    });

    const { stdout: pidOutput, exitCode } = await execRemoteCommand({
      ...sshParams,
      command: downloadCmd,
      timeout: 30000,
    });
    const pid = parseInt(pidOutput.trim(), 10);

    if (exitCode === 0 && pid > 0) {
      await indexDownloadedFileEntry({
        storageNode: server.storageNode,
        targetPath,
        fileName,
        size: null,
      });

      await prisma.downloadTask.update({
        where: { id: taskId },
        data: { pid, progress: "下载中..." },
      });
    } else {
      const { stdout: logContent } = await execRemoteCommand({
        ...sshParams,
        command: getDirectDownloadLogCommand(taskId),
        timeout: 8000,
      });
      await prisma.downloadTask.update({
        where: { id: taskId },
        data: {
          status: "FAILED",
          errorMessage: logContent.trim() || "无法启动下载进程",
        },
      });
    }
  } catch (error) {
    logError("[DownloadAPI] Direct download execution failed:", error);
    try {
      await prisma.downloadTask.update({
        where: { id: taskId },
        data: {
          status: "FAILED",
          errorMessage: getPublicDownloadError(error),
        },
      });
    } catch {}
  }
}

/** Transfer file via scp */
async function transferFileViaSsh2(
  server: {
    host: string;
    port: number;
    username: string;
    sshKeyId: string | null;
    password: string | null;
    storageNode?: { id: string; basePath: string | null } | null;
    sshKey?: { privateKey: string } | null;
  },
  localFilePath: string,
  remoteFilePath: string,
  taskId: string,
): Promise<void> {
  const scpArgs = [
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-P",
    String(server.port || 22),
  ];
  const target = toScpTarget(server.username || "root", server.host, remoteFilePath);

  if (server.sshKey?.privateKey) {
    const keyFile = path.join("/tmp", `app-key-${taskId}-${randomUUID()}`);
    await fs.writeFile(keyFile, server.sshKey.privateKey, { mode: 0o600 });
    try {
      await execFileAsync(
        "scp",
        [...scpArgs, "-i", keyFile, localFilePath, target],
        { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 },
      );
    } finally {
      await fs.unlink(keyFile).catch(() => {});
    }
  } else if (server.password) {
    const sshpassEnv = { ...process.env, SSHPASS: server.password };
    await execFileAsync(
      "sshpass",
      ["-e", "scp", ...scpArgs, localFilePath, target],
      { timeout: 600_000, maxBuffer: 50 * 1024 * 1024, env: sshpassEnv },
    );
  } else {
    throw new Error("No SSH key or password for file transfer");
  }
}

async function cleanupTemp(tempDir: string) {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {}
}
