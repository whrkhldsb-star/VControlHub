import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import {
  ensureAria2Daemon,
  pauseDownload,
  unpauseDownload,
  tellStatus,
  changeOption,
  changeGlobalOption,
} from "@/lib/aria2/service";
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { shellQuote } from "@/lib/downloads/remote-command";
import { sessionHasPermission } from "@/lib/auth/authorization";
import {
  deriveDownloadFileNameFromUrl,
  mapAria2Status,
  buildProgressText,
  indexDownloadedFileEntry,
} from "@/lib/downloads/helpers";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { AppError, AuthError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { canAccessDownloadTask, taskDownloadAccess } from "@/lib/downloads/route-helpers";

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
            locale,
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
              outputPath ? `  echo ${shellQuote(outputPath)}` : "  echo",
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
            const [remoteState, sizeLine, resolvedPathLine] = stdout.trim().split(/\r?\n/);
            if (remoteState === "COMPLETED") {
              const size = /^\d+$/.test(sizeLine ?? "") ? sizeLine : null;
              const resolvedFileName =
                task.fileName ||
                (resolvedPathLine ? resolvedPathLine.split("/").filter(Boolean).pop() ?? null : null) ||
                deriveDownloadFileNameFromUrl(task.url);
              const data = {
                status: "COMPLETED" as const,
                progress: t("apiDownloads.completed", locale),
                ...(resolvedFileName && !task.fileName ? { fileName: resolvedFileName } : {}),
                ...(size
                  ? { fileSize: size, totalBytes: size, completedBytes: size }
                  : {}),
              };
              await indexDownloadedFileEntry({
                storageNode: task.server.storageNode,
                targetPath: task.targetPath,
                fileName: resolvedFileName,
                size: size ? BigInt(size) : null,
              });
              await prisma.downloadTask.update({ where: { id: taskId }, data });
              const downloadAccess = taskDownloadAccess({
                ...task,
                locale,
                status: data.status,
                fileName: resolvedFileName,
                relayMode: task.relayMode ?? null,
              });
              return NextResponse.json({
                status: data.status,
                progress: data.progress,
                ...(resolvedFileName ? { fileName: resolvedFileName } : {}),
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
