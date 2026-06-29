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
import { parseSearchParams } from "@/lib/http/parse-search-params";
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
  deriveDownloadFileNameFromUrl,
  mapAria2Status,
  buildProgressText,
  isMagnetLink,
} from "@/lib/downloads/helpers";
import { buildDirectAccessStrategy } from "@/lib/storage/service";
import { cleanupTemp } from "@/lib/downloads/execution";
import { enqueueDownloadExecutionJob } from "@/lib/downloads/execution-worker";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { AppError, AuthError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { getServerLocale, t } from "@/lib/i18n/translations";
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

function taskCompletedFileRelativePath(task: {
  url: string;
  targetPath: string | null;
  fileName: string | null;
  server?: { storageNode?: { basePath: string } | null } | null;
}) {
  const storageNode = task.server?.storageNode;
  const fileName = task.fileName || deriveDownloadFileNameFromUrl(task.url);
  if (!storageNode || !task.targetPath || !fileName) return null;
  try {
    return getDownloadTargetRelativePath(
      storageNode.basePath,
      `${task.targetPath.replace(/\/$/, "")}/${fileName}`,
    );
  } catch {
    return null;
  }
}

function taskDownloadAccess(task: {
  url: string;
  status: string;
  targetPath: string | null;
  fileName: string | null;
  relayMode: boolean | null;
  server?: {
    storageNode?: {
      id: string;
      basePath: string;
      driver?: "LOCAL" | "SFTP" | null;
      host?: string | null;
      port?: number | null;
      directAccessMode?: "PROXY" | "DIRECT" | "AUTO" | null;
      publicBaseUrl?: string | null;
      directAccessExpiresSeconds?: number | null;
    } | null;
  } | null;
}) {
  if (task.status !== "COMPLETED") return null;
  const storageNode = task.server?.storageNode;
  const relativePath = taskCompletedFileRelativePath(task);
  if (!storageNode || !relativePath) return null;

  const strategy = buildDirectAccessStrategy({
    driver: storageNode.driver === "SFTP" ? "SFTP" : "LOCAL",
    nodeId: storageNode.id,
    host: storageNode.host,
    port: storageNode.port,
    relativePath,
    directAccessMode: storageNode.directAccessMode,
    publicBaseUrl: storageNode.publicBaseUrl,
    directAccessExpiresSeconds: storageNode.directAccessExpiresSeconds,
  });

  const href = strategy.href
    ? `${strategy.href}${strategy.href.includes("?") ? "&" : "?"}download=1`
    : null;
  if (!href) return null;

  const isDirect = strategy.mode === "direct-url";
  return {
    mode: strategy.mode,
    transport: isDirect ? "direct" as const : "relay" as const,
    href,
    fallbackHref: "fallbackHref" in strategy && strategy.fallbackHref
      ? `${strategy.fallbackHref}${strategy.fallbackHref.includes("?") ? "&" : "?"}download=1`
      : null,
    label: t("apiDownloads.label", "zh"),
    statusLabel: isDirect ? t("apiDownloads.statusLabelDirect", "zh") : t("apiDownloads.statusLabelRelay", "zh"),
    description: strategy.description,
  };
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
  url: z.string().url(t("apiDownloads.urlInvalid", "zh")),
  serverId: z.string().min(1, t("apiDownloads.missingServerId", "zh")),
  targetPath: z.string().min(1, t("apiDownloads.missingTargetPath", "zh")),
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
      errorMessage: t("apiDownloads.createTaskFailed", "zh"),
      bodySchema: postDownloadSchema,
    },
    async ({ session, body }) => {
      const locale = await getServerLocale();
      if (!session)
        throw new AuthError(t("apiDownloads.unauthorized", locale));
      const {
        url,
        serverId,
        targetPath,
        fileName,
        category,
        maxSpeedKb,
        isBatch,
        batchUrls,
      } = body;

      const allUrls = isBatch && batchUrls?.length ? batchUrls : [url];
      // Batch mode semantics:
      //  - HTTP/HTTPS batch with >1 URL → create one independent download task
      //    per URL (looped below). Each link is fetched separately.
      //  - Magnet/BT links must each be their own relay task; mixing magnets
      //    into a multi-URL HTTP batch is rejected because the two execution
      //    paths (direct vs aria2 relay) cannot be combined in one request.
      const hasMagnet = allUrls.some(isMagnetLink);
      if (isBatch && allUrls.length > 1 && hasMagnet) {
        return NextResponse.json(
          {
            error:
              t("apiDownloads.magnetMixedInBatch", locale),
          },
          { status: 400 },
        );
      }
      // For an HTTP/HTTPS batch we iterate over every URL; otherwise this is a
      // single-task request (one HTTP link or one magnet relay).
      const isHttpBatch = isBatch && allUrls.length > 1 && !hasMagnet;
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
        throw new NotFoundError(t("apiDownloads.serverNotFound", locale));
      if (!server.storageNode) {
        return NextResponse.json(
          { error: t("apiDownloads.serverMissingStorage", locale) },
          { status: 400 },
        );
      }
      if (!server.sshKey && !server.password)
        return NextResponse.json(
          { error: t("apiDownloads.serverMissingCredentials", locale) },
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
            error: error instanceof Error ? error.message : t("apiDownloads.invalidTargetPath", locale),
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
          { error: accessDecision.reason ?? t("apiDownloads.accessDenied", locale) },
          { status: 403 },
        );
      }

      let safeFileName: string | null;
      try {
        safeFileName = normalizeDownloadFileName(fileName);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : t("apiDownloads.invalidFileName", locale) },
          { status: 400 },
        );
      }

      const relayMode = allUrls.some(isMagnetLink);

      // Determine the list of URLs that each become their own task.
      //  - HTTP batch: one task per URL.
      //  - Single HTTP or magnet relay: a single task (magnet relay may carry
      //    multiple magnet URLs into one aria2 task, handled below).
      const taskUrls = isHttpBatch ? allUrls : [allUrls[0]!];

      const createdTaskIds: string[] = [];
      // New-A (2026-06-15): we used to dispatch `download.execute` jobs via
      // `void enqueueDownloadExecutionJob(...).catch(logError)` (fire-and-
      // forget). A short Prisma/Jobs-table blip would leave a downloadTask
      // row in `PENDING` forever with no durable job to pick it up. Now the
      // route waits for the enqueue synchronously and rolls back any tasks
      // that have already been created in this batch if the dispatch path
      // fails — the user gets a real 5xx with a business-level errorMessage
      // instead of a misleading `success: true` and a stuck row.
      const failedTaskIds: string[] = [];
      let dispatchError: { taskId: string; message: string } | null = null;

      for (const taskUrl of taskUrls) {
        // For an HTTP batch a single user-supplied fileName cannot apply to
        // every link, so only honour it for single-task requests.
        const taskFileName = isHttpBatch ? null : safeFileName;

        const task = await prisma.downloadTask.create({
          data: {
            url: taskUrl,
            serverId,
            targetPath: resolvedTargetPath,
            fileName: taskFileName,
            status: "PENDING",
            progress: relayMode ? t("apiDownloads.progressRelay", locale) : t("apiDownloads.progressDirect", locale),
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
        createdTaskIds.push(task.id);

        try {
          // TR-001 (T12): aria2 relay / direct dispatch is durable — the
          // worker poll loop (download-execution-worker) will pick this job
          // up, re-fetch the task/server from prisma, and call
          // executeAria2RelayDownload / executeDirectDownload. We now `await`
          // the enqueue so a transient jobs-table / Prisma blip surfaces as
          // a 5xx to the caller instead of a silently-PENDING task row.
          await enqueueDownloadExecutionJob({
            mode: relayMode ? "aria2_relay" : "direct",
            taskId: task.id,
            userId: session.userId,
            // TR-001 T13b: propagate the target storage node so the
            // per-node concurrency cap inside `claimNextJob` can count
            // in-flight jobs targeting the same node. The route already
            // validated that `server.storageNode` is non-null above
            // (line 229), so the bang is safe.
            storageNodeId: server.storageNode!.id,
          });
        } catch (dispatchFailure) {
          const message =
            dispatchFailure instanceof Error
              ? dispatchFailure.message
              : t("apiDownloads.enqueueFailed", locale);
          failedTaskIds.push(task.id);
          logError(
            `[DownloadAPI] Failed to enqueue ${relayMode ? "aria2 relay" : "direct download"} job for task ${task.id}:`,
            dispatchFailure,
          );
          dispatchError = { taskId: task.id, message };
          // Stop the batch at the first dispatch failure so we don't keep
          // creating more downloadTask rows that would also need rolling
          // back; the catch-block below rolls back both this row and any
          // previously created ones in the same request.
          break;
        }

        auditUserAction(session.userId, "download.create", {
          url: taskUrl!,
          serverId,
          targetPath: resolvedTargetPath,
          taskId: task.id,
          relayMode: relayMode ?? false,
          category: category ?? "",
          isBatch: isBatch ?? false,
        });
      }

      if (dispatchError) {
        // Roll back every task created in this request — both the one whose
        // enqueue failed and any that succeeded before it (in batch mode).
        // Use a Set so we never double-update the same row in the single-task
        // case (where `failedTaskIds` and `createdTaskIds` both contain the
        // same id because the loop pushes before it bails). This keeps the
        // user-visible state consistent: no "PENDING forever" task row will
        // outlive a failed dispatch.
        const allRolledBackIds = Array.from(
          new Set([...failedTaskIds, ...createdTaskIds]),
        );
        await Promise.allSettled(
          allRolledBackIds.map((id) =>
            prisma.downloadTask.update({
              where: { id },
              data: {
                status: "FAILED",
                progress: t("apiDownloads.dispatchFailed", locale),
                errorMessage: dispatchError!.message,
              },
            }),
          ),
        );
        // Audit the failure so the operation-tasks center / 运维看板 still
        // see the attempt; we do NOT audit it as a successful
        // `download.create`.
        auditUserAction(session.userId, "download.dispatch_failed", {
          taskId: dispatchError.taskId,
          taskIds: allRolledBackIds,
          errorMessage: dispatchError.message,
          relayMode: relayMode ?? false,
          isBatch: isBatch ?? false,
        });
        return NextResponse.json(
          {
            error: t("apiDownloads.createFailedWithMessage", locale).replace("{message}", dispatchError.message),
            code: "DOWNLOAD_DISPATCH_FAILED",
            taskIds: allRolledBackIds,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        taskId: createdTaskIds[0],
        taskIds: createdTaskIds,
        count: createdTaskIds.length,
        relayMode,
      });
    },
  );
}

/* ── GET: List tasks with real-time aria2 progress ────────── */

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: t("apiDownloads.fetchTasksFailed", "zh") },
    async ({ session }) => {
      const locale = await getServerLocale();
      if (!session)
        throw new AuthError(t("apiDownloads.unauthorized", locale));
      const { serverId, category } = parseSearchParams(
        request,
        z.object({
          serverId: z.string().trim().min(1).optional(),
          category: z.string().trim().min(1).optional(),
        }),
      );

      const where: Record<string, unknown> = {};
      if (serverId) where.serverId = serverId;
      if (category) where.category = category;

      const tasks = await prisma.downloadTask.findMany({
        where,
        include: {
          server: { select: { id: true, name: true, host: true, storageNode: { select: { id: true, basePath: true, driver: true, host: true, port: true, directAccessMode: true, publicBaseUrl: true, directAccessExpiresSeconds: true } } } },
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
                        progress: t("apiDownloads.completed", locale),
                        completedBytes: a.completedLength,
                        totalBytes: a.totalLength,
                        downloadSpeed: a.downloadSpeed,
                      }
                    : a.status === "error" || a.status === "removed"
                      ? {
                          status: "FAILED" as const,
                          progress,
                          errorMessage: t("apiDownloads.aria2ErrorWithStatus", locale).replace("{status}", a.status),
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
        downloadAccess: taskDownloadAccess(t),
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
      errorMessage: t("apiDownloads.operationFailed", "zh"),
      bodySchema: patchDownloadSchema,
    },
    async ({ session, body }) => {
      const locale = await getServerLocale();
      if (!session)
        throw new AuthError(t("apiDownloads.unauthorized", locale));
      const { taskId, action, maxSpeedKb, globalMaxSpeedKb } = body;

      // Global speed limit
      if (globalMaxSpeedKb !== undefined) {
        if (!sessionHasPermission(session, "storage:manage-node")) {
          throw new ForbiddenError(t("apiDownloads.missingGlobalSpeedPermission", locale));
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
            { error: t("apiDownloads.setGlobalSpeedFailed", locale) },
            { status: 500 },
          );
        }
      }

      if (!taskId)
        throw new ValidationError(t("apiDownloads.missingTaskId", locale));

      const task = await prisma.downloadTask.findUnique({
        where: { id: taskId },
        include: { server: { include: { sshKey: true, storageNode: true } } },
      });
      if (!task)
        throw new NotFoundError(t("apiDownloads.taskNotFound", locale));
      if (!(await canAccessDownloadTask({ session, task, operation: "write" }))) {
        throw new ForbiddenError(t("apiDownloads.noControlPermission", locale));
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
          throw new AppError({ code: "INTERNAL_ERROR", message: t("apiDownloads.setSpeedFailed", locale), status: 500 });
        }
      }

      if (action === "pause" && task.aria2Gid) {
        try {
          await pauseDownload(task.aria2Gid);
        } catch (err) {
          logError("[DownloadAPI] Failed to pause aria2 download:", err);
          return NextResponse.json(
            { error: t("apiDownloads.pauseFailed", locale) },
            { status: 502 },
          );
        }
        await prisma.downloadTask.update({
          where: { id: taskId },
          data: { status: "PENDING", progress: t("apiDownloads.paused", locale) },
        });
        return NextResponse.json({ success: true });
      }

      if (action === "resume" && task.aria2Gid) {
        try {
          await unpauseDownload(task.aria2Gid);
        } catch (err) {
          logError("[DownloadAPI] Failed to unpause aria2 download:", err);
          return NextResponse.json(
            { error: t("apiDownloads.unpauseFailed", locale) },
            { status: 502 },
          );
        }
        await prisma.downloadTask.update({
          where: { id: taskId },
          data: { status: "RUNNING", progress: t("apiDownloads.resuming", locale) },
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
          const downloadAccess = taskDownloadAccess({
            ...task,
            status: newStatus,
            fileName: task.fileName ?? null,
            relayMode: task.relayMode ?? null,
          });
          return NextResponse.json({
            status: newStatus,
            progress,
            completedBytes: st.completedLength,
            totalBytes: st.totalLength,
            downloadSpeed: st.downloadSpeed,
            downloadAccess,
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
                progress: t("apiDownloads.completed", locale),
                ...(size
                  ? { fileSize: size, totalBytes: size, completedBytes: size }
                  : {}),
              };
              await prisma.downloadTask.update({ where: { id: taskId }, data });
              const downloadAccess = taskDownloadAccess({
                ...task,
                status: data.status,
                fileName: task.fileName ?? null,
                relayMode: task.relayMode ?? null,
              });
              return NextResponse.json({
                status: data.status,
                progress: data.progress,
                ...(size
                  ? { fileSize: size, totalBytes: size, completedBytes: size }
                  : {}),
                downloadAccess,
              });
            }
            if (remoteState === "FAILED") {
              const data = {
                status: "FAILED" as const,
                progress: t("apiDownloads.failed", locale),
                errorMessage: t("apiDownloads.remoteProcessFailed", locale),
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

      throw new ValidationError(t("apiDownloads.unknownAction", locale));
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
      errorMessage: t("apiDownloads.cancelTaskFailed", "zh"),
    },
    async ({ session }) => {
      const locale = await getServerLocale();
      if (!session)
        throw new AuthError(t("apiDownloads.unauthorized", locale));
      const { taskId, purge } = parseSearchParams(
        request,
        z.object({
          taskId: z.string().trim().min(1, t("apiDownloads.missingTaskId", locale)),
          purge: z
            .string()
            .optional()
            .transform((value) => value === "1"),
        }),
      );

      const task = await prisma.downloadTask.findUnique({
        where: { id: taskId },
        include: { server: { include: { sshKey: true, storageNode: true } } },
      });
      if (!task)
        throw new NotFoundError(t("apiDownloads.taskNotFound", locale));
      if (!(await canAccessDownloadTask({ session, task, operation: "delete" }))) {
        throw new ForbiddenError(t("apiDownloads.noCancelPermission", locale));
      }

      // Purge: hard-delete a terminal-state task row from history.

      if (purge) {
        if (task.status === "RUNNING" || task.status === "PENDING") {
          return NextResponse.json(
            { error: t("apiDownloads.cancelActiveFirst", locale) },
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
            { error: t("apiDownloads.aria2CancelFailed", locale) },
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
                { error: t("apiDownloads.localRelayCancelFailed", locale) },
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
              { error: t("apiDownloads.remoteProcessCancelFailed", locale) },
              { status: 502 },
            );
          }
        }
      }

      await prisma.downloadTask.update({
        where: { id: taskId },
        data: { status: "CANCELLED", errorMessage: t("apiDownloads.userCancelled", locale) },
      });

      auditUserAction(session.userId, "download.cancel", {
        taskId,
        url: task.url,
      });
      return NextResponse.json({ success: true });
    },
  );
}
