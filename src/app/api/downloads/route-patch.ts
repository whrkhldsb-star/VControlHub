import { directEndpointChanged, directLaunchReceipt, lockDirectResultBinding } from "@/lib/downloads/direct-identity";
import { Prisma } from "@prisma/client";
import { enqueueDownloadExecutionJob, DOWNLOAD_EXECUTION_JOB_TYPE } from "@/lib/downloads/execution-worker";
import { RELAY_PAUSE_MS, parseTransferManifest, relayMetadataGid, relayPauseDeadline, relayState, relayPauseReceipt } from "@/lib/downloads/transfer-manifest";
import { relayContentStatus } from "@/lib/downloads/relay-status";
import { resolveTaskDrive } from "@/lib/downloads/destination";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import {
  ensureAria2Daemon,
  pauseDownload,
  unpauseDownload,
  changeOption,
  changeGlobalOption,
} from "@/lib/aria2/service";
import { buildSshParamsFromServer } from "@/lib/ssh/client";
import { directProgress, probeDirectDownloadRemote } from "@/lib/downloads/reconcile";
import { sessionHasPermission } from "@/lib/auth/authorization";
import {
  deriveDownloadFileNameFromUrl,
  isMagnetLink,
  mapAria2RelayStatus,
  buildProgressText,
  indexDownloadedFileEntry,
} from "@/lib/downloads/helpers";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { isGlobalTeamManager, serverTeamWhere, teamAccessFilter } from "@/lib/auth/team-scope";
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
        where: { id: taskId, ...(teamFilter ?? {}), server: serverTeamWhere(session, "connect") },
        include: { server: { include: { sshKey: true, storageNode: true, agentFileShares: { select: { node: true } } } } },
      }).then(row => row ? resolveTaskDrive(row) : null);
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

      const currentOutcome = async (status = 200) => {
        const row = await prisma.downloadTask.findUnique({ where: { id: taskId }, select: { status: true, progress: true } });
        if (!row) throw new NotFoundError(t("apiDownloads.taskNotFound", locale));
        return NextResponse.json(row, { status });
      };
      const relaySnapshot = {
        id: taskId, status: task.status, aria2Gid: task.aria2Gid,
        transferManifest: { equals: task.transferManifest ?? Prisma.DbNull },
      };
      if (action === "pause" && task.aria2Gid) {
        if (parseTransferManifest(task.transferManifest)) return NextResponse.json({ error: t("apiDownloads.finishingTransfer", locale) }, { status: 409 });
        if (task.status === "PENDING") return currentOutcome();
        let contentGid = task.aria2Gid;
        try {
          if (task.url && isMagnetLink(task.url)) contentGid = (await relayContentStatus(task.aria2Gid)).gid;
          await pauseDownload(contentGid);
        } catch (err) {
          logError("[DownloadAPI] Failed to pause aria2 download:", err);
          return NextResponse.json(
            { error: t("apiDownloads.pauseFailed", locale) },
            { status: 502 },
          );
        }
        const pausedUntil = Date.now() + RELAY_PAUSE_MS;
        const pause = (previous: typeof task.transferManifest, previousGid: string) => prisma.downloadTask.updateMany({
          where: { id: taskId, status: "RUNNING", aria2Gid: previousGid, transferManifest: { equals: previous ?? Prisma.DbNull } },
          data: { status: "PENDING", aria2Gid: contentGid, transferManifest: {
            ...relayPauseReceipt(previous, pausedUntil),
            ...(contentGid !== task.aria2Gid ? { metadataGid: relayMetadataGid(previous) ?? task.aria2Gid! } : {}),
          }, progress: t("apiDownloads.paused", locale) },
        });
        let changed = await pause(task.transferManifest, task.aria2Gid);
        if (!changed.count && contentGid !== task.aria2Gid) {
          const live = await prisma.downloadTask.findUnique({ where: { id: taskId }, select: { status: true, aria2Gid: true, transferManifest: true } });
          if (live?.status === "RUNNING" && live.aria2Gid === contentGid && relayMetadataGid(live.transferManifest) === task.aria2Gid
            && !parseTransferManifest(live.transferManifest)) changed = await pause(live.transferManifest, contentGid);
        }
        if (!changed.count) return currentOutcome(409);
        return NextResponse.json({ success: true });
      }

      if (action === "resume" && task.aria2Gid) {
        if (task.status === "PENDING" && relayPauseDeadline(task) <= Date.now()) return currentOutcome(409);
        try {
          await unpauseDownload(task.aria2Gid);
        } catch (err) {
          logError("[DownloadAPI] Failed to unpause aria2 download:", err);
          // A preceding resume may have reached the daemon but lost its DB transaction.
          const live = await relayContentStatus(task.aria2Gid).catch(() => null);
          if (!live || !["active", "waiting", "complete"].includes(live.status.status)) {
            return NextResponse.json({ error: t("apiDownloads.unpauseFailed", locale) }, { status: 502 });
          }
        }
        const receipt = relayState(task.transferManifest);
        const resumed = await prisma.$transaction(async tx => {
          const changed = await tx.downloadTask.updateMany({
            where: relaySnapshot,
            data: { status: "RUNNING", ...(task.status === "PENDING" ? { transferManifest: { ...receipt, deadline: Date.now() + 7200_000 } } : {}), progress: t("apiDownloads.resuming", locale) },
          });
          if (!changed.count) return false;
          const now = new Date();
          const retryable = { lt: tx.job.fields.maxAttempts };
          const executor = await tx.job.findFirst({ where: {
            type: DOWNLOAD_EXECUTION_JOB_TYPE, payload: { path: ["taskId"], equals: taskId },
            OR: [
              { status: "PENDING", attempts: retryable },
              { status: "RUNNING", OR: [{ leaseExpiresAt: { gte: now } }, { attempts: retryable }] },
            ],
          }, select: { id: true } });
          if (!executor) await enqueueDownloadExecutionJob({ taskId, mode: "aria2_relay", teamId: task.teamId, userId: task.createdBy,
            storageNodeId: task.server.storageNode?.id }, tx);
          return true;
        });
        if (!resumed) return currentOutcome(409);
        return NextResponse.json({ success: true });
      }

      // Refresh: re-fetch aria2 status and return
      const viewConnection = sessionHasPermission(session, "storage:manage-node");
      if (action === "refresh" && task.aria2Gid && !active) {
        return NextResponse.json({
          status: task.status,
          progress: task.progress,
          downloadAccess: taskDownloadAccess({ ...task, locale, viewConnection, status: task.status, fileName: task.fileName ?? null, relayMode: task.relayMode ?? null }),
        });
      }

      if (action === "refresh" && task.aria2Gid) {
        try {
          await ensureAria2Daemon();
          const { status: st } = await relayContentStatus(task.aria2Gid);
          const progress = st.status === "complete"
            ? t("apiDownloads.transferPending", locale)
            : buildProgressText(st);
          const newStatus = mapAria2RelayStatus(st.status);
          const status = task.status === "PENDING" && newStatus !== "FAILED" ? task.status : newStatus;
          const pauseReceipt = status === "PENDING" && !parseTransferManifest(task.transferManifest)
            ? relayPauseReceipt(task.transferManifest, task.status === "PENDING" ? relayPauseDeadline(task) : Date.now() + RELAY_PAUSE_MS)
            : undefined;
          const changed = await prisma.downloadTask.updateMany({
            where: relaySnapshot,
            data: {
              status,
              ...(pauseReceipt ? { transferManifest: pauseReceipt } : {}),
              progress,
              completedBytes: st.completedLength,
              totalBytes: st.totalLength,
              downloadSpeed: st.downloadSpeed,
            },
          });
          if (!changed.count) return currentOutcome();
          const downloadAccess = taskDownloadAccess({
            ...task,
            locale,
            viewConnection,
            status,
            fileName: task.fileName ?? null,
            relayMode: task.relayMode ?? null,
          });
          return NextResponse.json({
            status,
            progress,
            completedBytes: st.completedLength,
            totalBytes: st.totalLength,
            downloadSpeed: st.downloadSpeed,
            downloadAccess,
          });
        } catch (err) {
          logError("[DownloadAPI] aria2 refresh failed:", err);
          return currentOutcome();
        }
      }

      // Non-aria2 refresh: inspect the real remote process/exit marker before reporting status.
      if (action === "refresh") {
        if (directEndpointChanged(task) || (task.directStorageNodeId && !task.server.storageNode)) return currentOutcome();
        if (task.pid && task.status === "RUNNING") {
          try {
            const sshParams = await buildSshParamsFromServer(
              task.server,
              task.server.sshKey,
              task.server.teamId,
            );
            const probe = await probeDirectDownloadRemote({
              taskId: task.id,
              pid: task.pid,
              url: task.url,
              fileName: task.fileName ?? null,
              targetPath: task.targetPath,
              sshParams,
              requiresReceipt: Boolean(directLaunchReceipt(task.transferManifest)),
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
              const won = await prisma.$transaction(async (tx) => {
                if (!await lockDirectResultBinding(tx, task.server, task.transferManifest)) return false;
                const changed = await tx.downloadTask.updateMany({ where: whileActive, data });
                if (!changed.count) return false;
                await indexDownloadedFileEntry({
                  preserveRecycled: true,
                  storageNode: task.server.storageNode,
                  targetPath: task.targetPath,
                  fileName: resolvedFileName,
                  size: size ? BigInt(size) : null,
                }, tx);
                return true;
              });
              if (!won) return currentOutcome();
              const downloadAccess = taskDownloadAccess({
                ...task,
                locale,
                viewConnection,
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
            if (probe.state === "RUNNING") {
              const progress = directProgress(probe, task);
              const stored = await prisma.downloadTask.updateMany({
                where: { id: taskId, status: "RUNNING", updatedAt: task.updatedAt }, data: progress,
              });
              return stored.count ? NextResponse.json({ status: "RUNNING", ...progress }) : currentOutcome();
            }
            if (probe.state === "UNVERIFIED") {
              const progress = t("fileUploadDropzone.status.unknown", locale);
              const stored = await prisma.downloadTask.updateMany({
                where: { id: taskId, status: "RUNNING", updatedAt: task.updatedAt }, data: { progress },
              });
              return stored.count ? NextResponse.json({ status: "RUNNING", progress }) : currentOutcome();
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
