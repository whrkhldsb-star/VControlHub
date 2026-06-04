import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { auditUserAction } from "@/lib/audit/service";
import {
  ensureAria2Daemon,
  removeDownload,
  pauseDownload,
  unpauseDownload,
  tellStatus,
  getGlobalStat,
  changeOption,
  changeGlobalOption,
} from "@/lib/aria2/service";
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";
import { shellQuote } from "@/lib/downloads/remote-command";
import {
  getDownloadTargetRelativePath,
  resolveDownloadTargetPath,
} from "@/lib/downloads/target-path";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { assertDownloadSourceUrlSafe } from "@/lib/downloads/source-url";
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
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

function taskTargetRelativePath(task: { targetPath: string | null; server?: { storageNode?: { basePath: string } | null } | null }) {
  const storageNode = task.server?.storageNode;
  if (!storageNode || !task.targetPath) return null;
  try {
    return getDownloadTargetRelativePath(storageNode.basePath, task.targetPath);
  } catch {
    return null;
  }
}

async function canAccessDownloadTask(input: {
  session: NonNullable<Awaited<ReturnType<typeof import("@/lib/auth/require-session").requireSession>>>;
  task: {
    createdBy: string | null;
    targetPath: string | null;
    server?: { storageNode?: { id: string; basePath: string } | null } | null;
  };
  operation: "read" | "write" | "delete";
}) {
  if (input.task.createdBy === input.session.userId) return true;
  const storageNode = input.task.server?.storageNode;
  if (!storageNode) return false;
  const relativePath = taskTargetRelativePath(input.task);
  if (relativePath === null) return false;
  const decision = await assertStorageAccess({
    session: input.session,
    storageNodeId: storageNode.id,
    relativePath,
    operation: input.operation,
  });
  return decision.allowed;
}


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
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "创建下载任务失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      const body = await request.json();
      const parsed = postDownloadSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "输入校验失败",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      }
      const {
        url,
        serverId,
        targetPath,
        fileName,
        category,
        maxSpeedKb,
        isBatch,
        batchUrls,
      } = parsed.data;

      const allUrls = isBatch && batchUrls?.length ? batchUrls : [url];
      if (
        isBatch &&
        allUrls.length > 1 &&
        allUrls.every((candidate) => !isMagnetLink(candidate))
      ) {
        return NextResponse.json(
          {
            error:
              "HTTP/HTTPS 批量下载暂不支持，请拆分为单个任务创建，避免只下载第一项",
          },
          { status: 400 },
        );
      }
      if (isBatch && allUrls.length > 1 && allUrls.some(isMagnetLink)) {
        return NextResponse.json(
          { error: "磁力/BT 批量下载暂不支持，请每次创建一个任务" },
          { status: 400 },
        );
      }
      for (const u of allUrls) {
        const validation = await assertDownloadSourceUrlSafe(u);
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
      let targetRelativePath: string;
      try {
        resolvedTargetPath = resolveDownloadTargetPath(
          server.storageNode.basePath,
          targetPath,
        );
        targetRelativePath = getDownloadTargetRelativePath(
          server.storageNode.basePath,
          resolvedTargetPath,
        );
      } catch (error) {
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : "下载目标路径无效",
          },
          { status: 400 },
        );
      }

      const accessDecision = await assertStorageAccess({
        session,
        storageNodeId: server.storageNode.id,
        relativePath: targetRelativePath,
        operation: "write",
      });
      if (!accessDecision.allowed) {
        return NextResponse.json(
          { error: accessDecision.reason ?? "没有该存储节点或路径的访问授权" },
          { status: 403 },
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
          batchUrls:
            isBatch && batchUrls?.length
              ? JSON.stringify(batchUrls)
              : JSON.stringify([]),
        },
      });

      const serverForExec: DownloadServer = {
        host: server.host,
        port: server.port,
        username: server.username,
        sshKeyId: server.sshKeyId,
        password: server.password,
        storageNode: server.storageNode
          ? { id: server.storageNode.id, basePath: server.storageNode.basePath }
          : null,
        sshKey: server.sshKey
          ? { privateKey: decryptSshPrivateKey(server.sshKey.privateKey ?? "") }
          : null,
      };

      if (relayMode) {
        executeAria2RelayDownload(
          task.id,
          serverForExec,
          allUrls,
          resolvedTargetPath,
          safeFileName,
          maxSpeedKb,
          session.userId,
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
          session.userId,
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
    },
  );
}

/* ── GET: List tasks with real-time aria2 progress ────────── */

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "获取下载任务失败" },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      const { searchParams } = new URL(request.url);
      const serverId = searchParams.get("serverId");
      const category = searchParams.get("category");

      const where: Record<string, unknown> = {};
      if (serverId) where.serverId = serverId;
      if (category) where.category = category;

      const tasks = await prisma.downloadTask.findMany({
        where,
        include: {
          server: { select: { id: true, name: true, host: true, storageNode: { select: { id: true, basePath: true } } } },
          creator: { select: { id: true, username: true, displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });

      const visibleTasks = [];
      for (const task of tasks) {
        if (await canAccessDownloadTask({ session, task, operation: "read" })) {
          visibleTasks.push(task);
        }
      }

      const activeGids = new Map<string, string>();
      for (const t of visibleTasks) {
        if (t.aria2Gid && ["PENDING", "RUNNING"].includes(t.status)) {
          activeGids.set(t.aria2Gid, t.id);
        }
      }
      let aria2Available = false;
      if (activeGids.size > 0) {
        try {
          await ensureAria2Daemon();
          aria2Available = true;
          const updates: Promise<unknown>[] = [];
          for (const [gid, taskId] of activeGids) {
            updates.push(
              tellStatus(gid).then((a) => {
                const progress = buildProgressText(a);
                const terminalUpdate =
                  a.status === "complete"
                    ? {
                        status: "COMPLETED" as const,
                        progress: "下载完成",
                        completedBytes: a.completedLength,
                        totalBytes: a.totalLength,
                        downloadSpeed: a.downloadSpeed,
                      }
                    : a.status === "error" || a.status === "removed"
                      ? {
                          status: "FAILED" as const,
                          progress,
                          errorMessage: `aria2 下载失败: ${a.status}`,
                          completedBytes: a.completedLength,
                          totalBytes: a.totalLength,
                          downloadSpeed: a.downloadSpeed,
                        }
                      : {
                          progress,
                          completedBytes: a.completedLength,
                          totalBytes: a.totalLength,
                          downloadSpeed: a.downloadSpeed,
                        };
                return prisma.downloadTask.update({
                  where: { id: taskId },
                  data: terminalUpdate,
                });
              }),
            );
          }
          await Promise.all(updates);
        } catch (err) {
          logError("[DownloadAPI] aria2 refresh skipped:", err);
        }
      }

      const safe = visibleTasks.map((t) => ({
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
      if (aria2Available) {
        try {
          globalStat = await getGlobalStat();
        } catch (err) {
          logError("[DownloadAPI] globalStat fetch failed:", err);
        }
      }

      return NextResponse.json({ tasks: safe, globalStat });
    },
  );
}

/* ── PATCH: Control tasks (pause/resume/speed limit/refresh) */

const patchDownloadSchema = z.object({
  taskId: z.string().optional(),
  action: z.enum(["pause", "resume", "refresh"]).optional(),
  maxSpeedKb: z.number().optional(),
  globalMaxSpeedKb: z.number().optional(),
});

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "操作失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      const body = await request.json();
      const parsed = patchDownloadSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "输入校验失败",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      }
      const { taskId, action, maxSpeedKb, globalMaxSpeedKb } = parsed.data;

      // Global speed limit
      if (globalMaxSpeedKb !== undefined) {
        if (!sessionHasPermission(session, "storage:manage-node")) {
          return NextResponse.json({ error: "缺少全局下载限速管理权限" }, { status: 403 });
        }
        try {
          await ensureAria2Daemon();
          await changeGlobalOption({
            "max-overall-download-limit": `${globalMaxSpeedKb}K`,
          });
          return NextResponse.json({ success: true });
        } catch (err) {
          logError("[DownloadAPI] Global speed limit failed:", err);
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
        include: { server: { include: { sshKey: true, storageNode: true } } },
      });
      if (!task)
        return NextResponse.json({ error: "任务不存在" }, { status: 404 });
      if (!(await canAccessDownloadTask({ session, task, operation: "write" }))) {
        return NextResponse.json({ error: "没有该下载任务的控制权限" }, { status: 403 });
      }

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
        } catch (err) {
          logError("[DownloadAPI] Per-task speed limit failed:", err);
          return NextResponse.json({ error: "设置限速失败" }, { status: 500 });
        }
      }

      if (action === "pause" && task.aria2Gid) {
        try {
          await pauseDownload(task.aria2Gid);
        } catch (err) {
          logError("[DownloadAPI] Failed to pause aria2 download:", err);
          return NextResponse.json(
            { error: "暂停下载失败，远端任务状态未改变" },
            { status: 502 },
          );
        }
        await prisma.downloadTask.update({
          where: { id: taskId },
          data: { status: "PENDING", progress: "已暂停" },
        });
        return NextResponse.json({ success: true });
      }

      if (action === "resume" && task.aria2Gid) {
        try {
          await unpauseDownload(task.aria2Gid);
        } catch (err) {
          logError("[DownloadAPI] Failed to unpause aria2 download:", err);
          return NextResponse.json(
            { error: "恢复下载失败，远端任务状态未改变" },
            { status: 502 },
          );
        }
        await prisma.downloadTask.update({
          where: { id: taskId },
          data: { status: "RUNNING", progress: "恢复下载..." },
        });
        return NextResponse.json({ success: true });
      }

      // Refresh: re-fetch aria2 status and return
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
          return NextResponse.json({
            status: newStatus,
            progress,
            completedBytes: st.completedLength,
            totalBytes: st.totalLength,
            downloadSpeed: st.downloadSpeed,
          });
        } catch (err) {
          logError("[DownloadAPI] aria2 refresh failed:", err);
          return NextResponse.json({
            status: task.status,
            progress: task.progress,
          });
        }
      }

      // Non-aria2 refresh: inspect the real remote process/exit marker before reporting status.
      if (action === "refresh") {
        if (task.pid && task.status === "RUNNING") {
          try {
            const sshParams = await buildSshParamsFromServer(
              task.server,
              task.server.sshKey,
            );
            const safeTaskFileStem = task.id.replace(/[^A-Za-z0-9_-]/g, "_");
            const pidFile = `/tmp/app-dl-${safeTaskFileStem}.pid`;
            const exitFile = `${pidFile}.exit`;
            const outputPath = task.fileName
              ? `${task.targetPath.replace(/\/$/, "")}/${task.fileName}`
              : "";
            const statSnippet = outputPath
              ? `if [ -f ${shellQuote(outputPath)} ]; then stat -c %s -- ${shellQuote(outputPath)} 2>/dev/null || echo 0; else echo 0; fi`
              : "echo 0";
            const probeCommand = [
              `if [ -f ${shellQuote(exitFile)} ]; then`,
              "  status=$(cat " + shellQuote(exitFile) + " 2>/dev/null || echo 1)",
              "  if [ \"$status\" = \"0\" ]; then echo COMPLETED; else echo FAILED; fi",
              `  ${statSnippet}`,
              `elif kill -0 ${task.pid} 2>/dev/null; then`,
              "  echo RUNNING",
              "  echo 0",
              "else",
              "  echo FAILED",
              "  echo 0",
              "fi",
            ].join("\n");
            const { stdout } = await execRemoteCommand({
              ...sshParams,
              command: probeCommand,
              timeout: 10000,
            });
            const [remoteState, sizeLine] = stdout.trim().split(/\r?\n/);
            if (remoteState === "COMPLETED") {
              const size = /^\d+$/.test(sizeLine ?? "") ? sizeLine : null;
              const data = {
                status: "COMPLETED" as const,
                progress: "下载完成",
                ...(size
                  ? { fileSize: size, totalBytes: size, completedBytes: size }
                  : {}),
              };
              await prisma.downloadTask.update({ where: { id: taskId }, data });
              return NextResponse.json({
                status: data.status,
                progress: data.progress,
                ...(size
                  ? { fileSize: size, totalBytes: size, completedBytes: size }
                  : {}),
              });
            }
            if (remoteState === "FAILED") {
              const data = {
                status: "FAILED" as const,
                progress: "下载失败",
                errorMessage: "远程下载进程已退出或失败",
              };
              await prisma.downloadTask.update({ where: { id: taskId }, data });
              return NextResponse.json({ status: data.status, progress: data.progress });
            }
          } catch (err) {
            logError("[DownloadAPI] direct download refresh failed:", err);
          }
        }
        return NextResponse.json({
          status: task.status,
          progress: task.progress,
        });
      }

      return NextResponse.json({ error: "未知操作" }, { status: 400 });
    },
  );
}

/* ── DELETE: Cancel task ──────────────────────────────────── */

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "取消任务失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      const { searchParams } = new URL(request.url);
      const taskId = searchParams.get("taskId");
      if (!taskId)
        return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });

      const task = await prisma.downloadTask.findUnique({
        where: { id: taskId },
        include: { server: { include: { sshKey: true, storageNode: true } } },
      });
      if (!task)
        return NextResponse.json({ error: "任务不存在" }, { status: 404 });
      if (!(await canAccessDownloadTask({ session, task, operation: "delete" }))) {
        return NextResponse.json({ error: "没有该下载任务的取消权限" }, { status: 403 });
      }

      // Purge: hard-delete a terminal-state task row from history.
      const purge = searchParams.get("purge") === "1";
      if (purge) {
        if (task.status === "RUNNING" || task.status === "PENDING") {
          return NextResponse.json(
            { error: "请先取消正在进行的任务，再删除记录" },
            { status: 409 },
          );
        }
        await prisma.downloadTask.delete({ where: { id: taskId } });
        auditUserAction(session.userId, "download.purge", {
          taskId,
          url: task.url,
        });
        return NextResponse.json({ success: true, purged: true });
      }

      if (task.aria2Gid) {
        try {
          await removeDownload(task.aria2Gid, true);
        } catch (err) {
          logError("[DownloadAPI] Failed to remove aria2 download:", err);
          return NextResponse.json(
            { error: "取消 aria2 下载失败，任务状态未改变" },
            { status: 502 },
          );
        }
      }

      if (task.status === "RUNNING") {
        if (task.relayMode) {
          if (task.pid) {
            try {
              process.kill(task.pid, "SIGTERM");
            } catch (err) {
              logError("[DownloadAPI] Failed to kill process:", err);
              return NextResponse.json(
                { error: "取消本地中转下载进程失败，任务状态未改变" },
                { status: 502 },
              );
            }
          }
          await cleanupTemp(`/tmp/app-relay-${taskId}`);
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
          } catch (err) {
            logError("[DownloadAPI] Failed to kill remote process:", err);
            return NextResponse.json(
              { error: "取消远程下载进程失败，任务状态未改变" },
              { status: 502 },
            );
          }
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
    },
  );
}
