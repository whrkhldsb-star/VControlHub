import { relayContentStatus } from "@/lib/downloads/relay-status";
import { Prisma } from "@prisma/client";
import { resolveTaskDrive } from "@/lib/downloads/destination";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { auditUserAction } from "@/lib/audit/service";
import { removeDownload } from "@/lib/aria2/service";
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import {
  buildDirectDownloadStopCommand,
  parseDirectDownloadStopResult,
} from "@/lib/downloads/remote-command";
import { cleanupTemp } from "@/lib/downloads/execution";
import { relayTempDir } from "@/lib/runtime/platform-paths";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { serverTeamWhere, teamAccessFilter } from "@/lib/auth/team-scope";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { canAccessDownloadTask } from "@/lib/downloads/route-helpers";

/* ── DELETE: Cancel task ──────────────────────────────────── */

export async function DELETE(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("apiDownloads.cancelTaskFailed", locale),
    },
    async ({ session }) => {
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

      const teamFilter = teamAccessFilter(session);
      const task = await prisma.downloadTask.findFirst({
        where: { id: taskId, ...(teamFilter ?? {}), server: serverTeamWhere(session, "connect") },
        include: { server: { include: { sshKey: true, storageNode: true, agentFileShares: { select: { node: true } } } } },
      }).then(row => row ? resolveTaskDrive(row) : null);
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
        await auditUserAction(session.userId, "download.purge", {
          taskId,
          url: task.url,
        }, undefined, session.currentTeamId);
        return NextResponse.json({ success: true, purged: true });
      }

      if (task.status === "CANCELLED") {
        return NextResponse.json({ success: true });
      }
      if (task.status !== "PENDING" && task.status !== "RUNNING") {
        return NextResponse.json(
          { error: t("apiDownloads.taskNoLongerActive", locale) },
          { status: 409 },
        );
      }

      const cancelledData = { status: "CANCELLED" as const, errorMessage: t("apiDownloads.userCancelled", locale) };
      const finishCancel = async () => {
        await auditUserAction(session.userId, "download.cancel", {
          taskId,
          url: task.url,
        }, undefined, session.currentTeamId);
        return NextResponse.json({ success: true });
      };

      // Once the immutable manifest is committed, the verified files are being
      // published. Cancellation and journaling compete on this same row.
      if (task.relayMode || task.agentStorageNodeId || task.aria2Gid) {
        if (task.transferManifest) {
          return NextResponse.json({ error: t("apiDownloads.finishingTransfer", locale) }, { status: 409 });
        }
        // Read the gid from the update: aria2 may have started since the initial lookup.
        const [cancelled] = await prisma.downloadTask.updateManyAndReturn({
          where: { id: taskId, transferManifest: { equals: Prisma.DbNull }, status: { in: ["PENDING", "RUNNING"] } },
          data: cancelledData,
          select: { aria2Gid: true, pid: true },
        });
        if (!cancelled) return NextResponse.json({ error: t("apiDownloads.taskNoLongerActive", locale) }, { status: 409 });
        if (cancelled.aria2Gid) {
          let gid = cancelled.aria2Gid;
          if (task.url.startsWith("magnet:?")) {
            try {
              gid = (await relayContentStatus(gid)).gid;
            } catch (error) {
              logError("[DownloadAPI] Could not resolve magnet content; stopping the recorded download:", error);
            }
          }
          try {
            await removeDownload(gid, true);
          } catch (err) {
            logError("[DownloadAPI] Failed to remove aria2 download after cancelling the task:", err);
          }
        }
        if (task.relayMode && cancelled.pid) {
          try { process.kill(cancelled.pid, "SIGTERM"); } catch (err) { logError("[DownloadAPI] Failed to kill process:", err); }
        }
        await cleanupTemp(relayTempDir(taskId));
        return finishCancel();
      }

      let status = task.status;
      if (status === "PENDING") {
        // A worker that has not claimed the task yet can no longer start it.
        const won = await prisma.downloadTask.updateMany({
          where: { id: taskId, status: "PENDING" },
          data: cancelledData,
        });
        if (won.count > 0) return finishCancel();
        // The worker claimed it meanwhile: it may already be starting the
        // remote process, so cancel it as a running task.
        const current = await prisma.downloadTask.findUnique({ where: { id: taskId }, select: { status: true, relayMode: true } });
        if (current?.relayMode) return NextResponse.json({ error: t("apiDownloads.finishingTransfer", locale) }, { status: 409 });
        if (current?.status === "CANCELLED") return NextResponse.json({ success: true });
        if (current?.status !== "RUNNING") {
          return NextResponse.json(
            { error: t("apiDownloads.taskNoLongerActive", locale) },
            { status: 409 },
          );
        }
        status = "RUNNING";
      }

      if (status === "RUNNING") {
        if (task.directStorageNodeId && !task.server.storageNode) {
          return NextResponse.json({ error: t("backend.downloads.taskStorageMissing", locale) }, { status: 409 });
        }
        // Always ask the server, with or without a stored pid: the remote
        // process records its own identity and may be running even when the
        // controller never stored the pid. Only a confirmed stop (no download
        // process left) may mark the task cancelled; otherwise it stays
        // RUNNING and the user can cancel again.
        let stopped = null;
        try {
          const sshParams = await buildSshParamsFromServer(
            task.server,
            task.server.sshKey,
          );
          stopped = parseDirectDownloadStopResult(await execRemoteCommand({
            ...sshParams,
            command: buildDirectDownloadStopCommand(task.id, task.targetPath, { cancel: true }),
            timeout: 20000,
          }));
        } catch (err) {
          logError("[DownloadAPI] Failed to kill remote process:", err);
        }
        if (!stopped) {
          return NextResponse.json(
            { error: t("apiDownloads.remoteProcessCancelFailed", locale) },
            { status: 502 },
          );
        }
      }

      const cancelled = await prisma.downloadTask.updateMany({
        where: { id: taskId, status: { in: ["PENDING", "RUNNING"] } },
        data: cancelledData,
      });
      if (cancelled.count === 0) {
        return NextResponse.json(
          { error: t("apiDownloads.taskNoLongerActive", locale) },
          { status: 409 },
        );
      }
      return finishCancel();
    },
  );
}
