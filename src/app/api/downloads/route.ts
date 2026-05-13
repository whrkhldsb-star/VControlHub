import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { auditUserAction } from "@/lib/audit/service";
import {
 ensureAria2Daemon,
 removeDownload,
 pauseDownload,
 unpauseDownload,
 tellActive,
 tellWaiting,
 tellStatus,
 getGlobalStat,
 changeOption,
 changeGlobalOption,
} from "@/lib/aria2/service";
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";
import { shellQuote } from "@/lib/downloads/remote-command";
import { resolveDownloadTargetPath } from "@/lib/downloads/target-path";
import { validateDownloadSourceUrl } from "@/lib/downloads/source-url";
import {
 normalizeDownloadFileName,
 mapAria2Status,
 buildProgressText,
 isMagnetLink,
} from "@/lib/downloads/helpers";
import {
 executeAria2RelayDownload,
 executeDirectDownload,
 cleanupTemp,
 type DownloadServer,
} from "@/lib/downloads/execution";

export const dynamic = "force-dynamic";

/* ── POST: Create download task ───────────────────────────── */

const postDownloadSchema = z.object({
 url: z.string().url("请输入有效的URL"),
 serverId: z.string().min(1, "缺少 serverId"),
 targetPath: z.string().min(1, "缺少 targetPath"),
 fileName: z.string().optional(),
 category: z.string().optional(),
 maxSpeedKb: z.number().optional(),
 isBatch: z.boolean().optional(),
 batchUrls: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
 const session = await requireSession();
 if (!sessionHasPermission(session, "storage:write")) {
  return NextResponse.json({ error: "缺少权限" }, { status: 403 });
 }

 try {
  const body = await request.json();
  const parsed = postDownloadSchema.safeParse(body);
  if (!parsed.success) {
   return NextResponse.json(
    { error: "输入校验失败", details: parsed.error.flatten().fieldErrors },
    { status: 400 },
   );
  }
  const { url, serverId, targetPath, fileName, category, maxSpeedKb, isBatch, batchUrls } = parsed.data;

  const allUrls = isBatch && batchUrls?.length ? batchUrls : [url];
  for (const u of allUrls) {
   const validation = validateDownloadSourceUrl(u);
   if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
   }
  }

  const server = await prisma.server.findUnique({
   where: { id: serverId },
   include: { sshKey: true, storageNode: true },
  });
  if (!server) return NextResponse.json({ error: "VPS 节点不存在" }, { status: 404 });
  if (!server.storageNode) {
   return NextResponse.json({ error: "该 VPS 未绑定存储节点，无法创建下载任务" }, { status: 400 });
  }
  if (!server.sshKey && !server.password)
   return NextResponse.json({ error: "该 VPS 未配置 SSH 密钥或密码" }, { status: 400 });

  let resolvedTargetPath: string;
  try {
   resolvedTargetPath = resolveDownloadTargetPath(server.storageNode.basePath, targetPath);
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
    batchUrls: isBatch && batchUrls?.length ? JSON.stringify(batchUrls) : JSON.stringify([]),
   },
  });

  const serverForExec: DownloadServer = {
   host: server.host,
   port: server.port,
   username: server.username,
   sshKeyId: server.sshKeyId,
   password: server.password,
   storageNode: server.storageNode ? { id: server.storageNode.id, basePath: server.storageNode.basePath } : null,
   sshKey: server.sshKey ? { privateKey: decryptSshPrivateKey(server.sshKey.privateKey ?? "") } : null,
  };

  if (relayMode) {
   executeAria2RelayDownload(task.id, serverForExec, allUrls, resolvedTargetPath, safeFileName, maxSpeedKb, session.userId).catch((error) => {
    logError("[DownloadAPI] Relay execution error:", error);
   });
  } else {
   executeDirectDownload(task.id, serverForExec, allUrls[0], resolvedTargetPath, safeFileName, session.userId).catch((error) => {
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

 try {
  await ensureAria2Daemon();
  const activeGids = new Map<string, string>();
  for (const t of tasks) {
   if (t.aria2Gid && t.status === "RUNNING") {
    activeGids.set(t.aria2Gid, t.id);
   }
  }
  if (activeGids.size > 0) {
   const [activeList, waitingList] = await Promise.all([tellActive(), tellWaiting()]);
   const allAria2 = [...activeList, ...waitingList];
   const updates: Promise<unknown>[] = [];
   for (const a of allAria2) {
    const taskId = activeGids.get(a.gid);
    if (taskId) {
     const progress = buildProgressText(a);
     updates.push(
      prisma.downloadTask.update({
       where: { id: taskId },
       data: { progress, completedBytes: a.completedLength, totalBytes: a.totalLength, downloadSpeed: a.downloadSpeed },
      }),
     );
    }
   }
   await Promise.all(updates);
  }
 } catch (err) {
  logError("[DownloadAPI] aria2 refresh skipped:", err);
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

 let globalStat = null;
 try {
  globalStat = await getGlobalStat();
 } catch (err) {
  logError("[DownloadAPI] globalStat fetch failed:", err);
 }

 return NextResponse.json({ tasks: safe, globalStat });
}

/* ── PATCH: Control tasks (pause/resume/speed limit/refresh) */

const patchDownloadSchema = z.object({
 taskId: z.string().optional(),
 action: z.enum(["pause", "resume", "refresh"]).optional(),
 maxSpeedKb: z.number().optional(),
 globalMaxSpeedKb: z.number().optional(),
});

export async function PATCH(request: Request) {
 const session = await requireSession();
 if (!sessionHasPermission(session, "storage:write")) {
  return NextResponse.json({ error: "缺少权限" }, { status: 403 });
 }

 try {
  const body = await request.json();
  const parsed = patchDownloadSchema.safeParse(body);
  if (!parsed.success) {
   return NextResponse.json(
    { error: "输入校验失败", details: parsed.error.flatten().fieldErrors },
    { status: 400 },
   );
  }
  const { taskId, action, maxSpeedKb, globalMaxSpeedKb } = parsed.data;

  // Global speed limit
  if (globalMaxSpeedKb !== undefined) {
   try {
    await ensureAria2Daemon();
    await changeGlobalOption({ "max-overall-download-limit": `${globalMaxSpeedKb}K` });
    return NextResponse.json({ success: true });
   } catch (err) {
    logError("[DownloadAPI] Global speed limit failed:", err);
    return NextResponse.json({ error: "设置全局限速失败" }, { status: 500 });
   }
  }

  if (!taskId) return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });

  const task = await prisma.downloadTask.findUnique({ where: { id: taskId } });
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  // Per-task speed limit
  if (maxSpeedKb !== undefined && task.aria2Gid) {
   try {
    await ensureAria2Daemon();
    await changeOption(task.aria2Gid, { "max-download-limit": `${maxSpeedKb}K` });
    await prisma.downloadTask.update({ where: { id: taskId }, data: { maxSpeedKb } });
    return NextResponse.json({ success: true });
   } catch (err) {
    logError("[DownloadAPI] Per-task speed limit failed:", err);
    return NextResponse.json({ error: "设置限速失败" }, { status: 500 });
   }
  }

  if (action === "pause" && task.aria2Gid) {
   try { await pauseDownload(task.aria2Gid); } catch (err) { logError("[DownloadAPI] Failed to pause aria2 download:", err); }
   await prisma.downloadTask.update({ where: { id: taskId }, data: { status: "PENDING", progress: "已暂停" } });
   return NextResponse.json({ success: true });
  }

  if (action === "resume" && task.aria2Gid) {
   try { await unpauseDownload(task.aria2Gid); } catch (err) { logError("[DownloadAPI] Failed to unpause aria2 download:", err); }
   await prisma.downloadTask.update({ where: { id: taskId }, data: { status: "RUNNING", progress: "恢复下载..." } });
   return NextResponse.json({ success: true });
  }

  // Refresh: re-fetch aria2 status and return
  if (action === "refresh" && task.aria2Gid) {
   try {
    await ensureAria2Daemon();
    const st = await tellStatus(task.aria2Gid);
    const progress = buildProgressText(st);
    const newStatus = mapAria2Status(st.status) as "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "PENDING";
    await prisma.downloadTask.update({
     where: { id: taskId },
     data: { status: newStatus, progress, completedBytes: st.completedLength, totalBytes: st.totalLength, downloadSpeed: st.downloadSpeed },
    });
    return NextResponse.json({ status: newStatus, progress });
   } catch (err) {
    logError("[DownloadAPI] aria2 refresh failed:", err);
    return NextResponse.json({ status: task.status, progress: task.progress });
   }
  }

  // Non-aria2 refresh (legacy)
  if (action === "refresh") {
   return NextResponse.json({ status: task.status, progress: task.progress });
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
  if (!taskId) return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });

  const task = await prisma.downloadTask.findUnique({
   where: { id: taskId },
   include: { server: { include: { sshKey: true } } },
  });
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  if (task.aria2Gid) {
   try { await removeDownload(task.aria2Gid, true); } catch (err) { logError("[DownloadAPI] Failed to remove aria2 download:", err); }
  }

  if (task.status === "RUNNING") {
   if (task.relayMode) {
    if (task.pid) {
     try { process.kill(task.pid, "SIGTERM"); } catch (err) { logError("[DownloadAPI] Failed to kill process:", err); }
    }
    await cleanupTemp(`/tmp/app-relay-${taskId}`);
   } else if (task.pid) {
    try {
     const sshParams = await buildSshParamsFromServer(task.server, task.server.sshKey);
     await execRemoteCommand({
      ...sshParams,
      command: `kill ${task.pid} 2>/dev/null; rm -f -- ${shellQuote(`/tmp/app-dl-${task.id}.pid`)}`,
      timeout: 10000,
     });
    } catch (err) { logError("[DownloadAPI] Failed to kill remote process:", err); }
   }
  }

  await prisma.downloadTask.update({ where: { id: taskId }, data: { status: "CANCELLED", errorMessage: "用户取消" } });

  auditUserAction(session.userId, "download.cancel", { taskId, url: task.url });
  return NextResponse.json({ success: true });
 } catch (error) {
  logError("[DownloadAPI] Cancel error:", error);
  return NextResponse.json({ error: "取消任务失败" }, { status: 500 });
 }
}
