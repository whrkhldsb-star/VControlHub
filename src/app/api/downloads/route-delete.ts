import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { auditUserAction } from "@/lib/audit/service";
import { removeDownload } from "@/lib/aria2/service";
import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { shellQuote } from "@/lib/downloads/remote-command";
import { cleanupTemp } from "@/lib/downloads/execution";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { AuthError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { teamAccessFilter } from "@/lib/auth/team-scope";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { canAccessDownloadTask } from "@/lib/downloads/route-helpers";

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

      const teamFilter = teamAccessFilter(session);
      const task = await prisma.downloadTask.findFirst({
        where: { id: taskId, ...(teamFilter ?? {}) },
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
        await auditUserAction(session.userId, "download.purge", {
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

      await auditUserAction(session.userId, "download.cancel", {
        taskId,
        url: task.url,
      });
      return NextResponse.json({ success: true });
    },
  );
}
