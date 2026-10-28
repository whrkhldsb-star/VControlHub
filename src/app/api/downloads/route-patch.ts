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
import { buildSshParamsFromServer } from "@/lib/ssh/client";
import { probeDirectDownloadRemote } from "@/lib/downloads/reconcile";
import { sessionHasPermission } from "@/lib/auth/authorization";
import {
  deriveDownloadFileNameFromUrl,
  mapAria2RelayStatus,
  buildProgressText,
  indexDownloadedFileEntry,
} from "@/lib/downloads/helpers";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isGlobalTeamManager, teamAccessFilter } from "@/lib/auth/team-scope";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { canAccessDownloadTask, taskDownloadAccess } from "@/lib/downloads/route-helpers";

/* ── PATCH: Control tasks (pause/resume/speed limit/refresh) */

const patchDownloadSchema = z.object({
  taskId: z.string().optional(),
  action: z.enum(["pause", "resume", "refresh"]).optional(),
  maxSpeedKb: z.number().int().min(0).max(10_000_000).optional(),
  globalMaxSpeedKb: z.number().int().min(0).max(10_000_000).optional(),
});

export async function PATCH(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("apiDownloads.operationFailed", locale),
      bodySchema: patchDownloadSchema,
    },
    async ({ session, body }) => {
      const { taskId, action, maxSpeedKb, globalMaxSpeedKb } = body;

      // Global speed limit
      if (globalMaxSpeedKb !== undefined) {
        // One aria2 daemon serves every customer, and this option is process-wide: a customer's administrator
        // (storage:manage-node) could otherwise throttle everyone else's downloads or lift the platform's limit.
        if (!isGlobalTeamManager(session) || !sessionHasPermission(session, "storage:manage-node")) {
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

      const teamFilter = teamAccessFilter(session);
      const task = await prisma.downloadTask.findFirst({
        where: { id: taskId, ...(teamFilter ?? {}) },
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

      // Pause, resume and refresh act on a download still in progress only. A
      // finished task keeps its aria2 gid, and aria2 reports it "complete":
      // a refresh used to turn a COMPLETED relay task back into RUNNING, and a
      // cancelled one into FAILED. Each write is also conditional, so a task
      // that finishes between the read above and the write keeps its outcome.
      const active = task.status === "PENDING" || task.status === "RUNNING";
      const whileActive = { id: taskId, status: { in: ["PENDING", "RUNNING"] as Array<"PENDING" | "RUNNING"> } };
      if ((action === "pause" || action === "resume") && task.aria2Gid && !active) {
        return NextResponse.json({ error: t("apiDownloads.taskNotActive", locale) }, { status: 409 });
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
        await prisma.downloadTask.updateMany({
          where: whileActive,
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
        await prisma.downloadTask.updateMany({
          where: whileActive,
          data: { status: "RUNNING", progress: t("apiDownloads.resuming", locale) },
        });
        return NextResponse.json({ success: true });
      }

      // Refresh: re-fetch aria2 status and return
      if (action === "refresh" && task.aria2Gid && !active) {
        return NextResponse.json({
          status: task.status,
          progress: task.progress,
          downloadAccess: taskDownloadAccess({ ...task, locale, status: task.status, fileName: task.fileName ?? null, relayMode: task.relayMode ?? null }),
        });
      }

      if (action === "refresh" && task.aria2Gid) {
        try {
          await ensureAria2Daemon();
          const st = await tellStatus(task.aria2Gid);
          const progress = st.status === "complete"
            ? t("apiDownloads.transferPending", locale)
            : buildProgressText(st);
          const newStatus = mapAria2RelayStatus(st.status);
          await prisma.downloadTask.updateMany({
            where: whileActive,
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
        const currentOutcome = async () => {
          const now = await prisma.downloadTask.findUnique({ where: { id: taskId }, select: { status: true, progress: true } });
          return NextResponse.json({ status: now?.status ?? task.status, progress: now?.progress ?? task.progress });
        };
        if (task.pid && task.status === "RUNNING") {
          try {
            const sshParams = await buildSshParamsFromServer(
              task.server,
              task.server.sshKey,
            );
            const probe = await probeDirectDownloadRemote({
              taskId: task.id,
              pid: task.pid,
              url: task.url,
              fileName: task.fileName ?? null,
              targetPath: task.targetPath,
              sshParams,
            });
            if (probe.state === "COMPLETED") {
              const size = probe.size;
              const resolvedFileName =
                probe.resolvedFileName ?? deriveDownloadFileNameFromUrl(task.url);
              const data = {
                status: "COMPLETED" as const,
                progress: t("apiDownloads.completed", locale),
                ...(resolvedFileName && !task.fileName ? { fileName: resolvedFileName } : {}),
                ...(size
                  ? { fileSize: size, totalBytes: size, completedBytes: size }
                  : {}),
              };
              // The probe took a while: a task cancelled meanwhile keeps its
              // outcome (and gets no file index), like the aria2 branch above.
              const won = await prisma.downloadTask.updateMany({ where: whileActive, data });
              if (won.count === 0) return currentOutcome();
              await indexDownloadedFileEntry({
                storageNode: task.server.storageNode,
                targetPath: task.targetPath,
                fileName: resolvedFileName,
                size: size ? BigInt(size) : null,
              });
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
            if (probe.state === "FAILED") {
              const data = {
                status: "FAILED" as const,
                progress: t("apiDownloads.failed", locale),
                errorMessage: t("apiDownloads.remoteProcessFailed", locale),
              };
              const won = await prisma.downloadTask.updateMany({ where: whileActive, data });
              if (won.count === 0) return currentOutcome();
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

      if (action === "pause" || action === "resume") {
        throw new ValidationError(
          t("apiDownloads.pauseResumeRequiresAria2", locale),
        );
      }

      throw new ValidationError(t("apiDownloads.unknownAction", locale));
    },
  );
}
