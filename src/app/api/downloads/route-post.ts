import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { auditUserAction } from "@/lib/audit/service";
import { enqueueDownloadExecutionJob } from "@/lib/downloads/execution-worker";
import { assertDownloadSourceUrlSafe } from "@/lib/downloads/source-url";
import {
  normalizeDownloadFileName,
  isMagnetLink,
} from "@/lib/downloads/helpers";
import {
  getDownloadTargetRelativePath,
  resolveDownloadTargetPath,
} from "@/lib/downloads/target-path";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { AuthError, NotFoundError } from "@/lib/errors";
import { teamCreateData } from "@/lib/auth/team-scope";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { getServerLocale, t } from "@/lib/i18n/translations";

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

      const teamAccess = await assertServerTeamAccess(session, serverId);
      if (!teamAccess.ok) return teamAccess.response;

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
            ...teamCreateData(session),
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
            teamId: session.currentTeamId ?? null,
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

        await auditUserAction(session.userId, "download.create", {
          url: taskUrl!,
          serverId,
          targetPath: resolvedTargetPath,
          taskId: task.id,
          relayMode: relayMode ?? false,
          category: category ?? "",
          isBatch: isBatch ?? false,
        }, undefined, session?.currentTeamId);
      }

      if (dispatchError) {
        // Only mark tasks whose enqueue actually failed. Earlier batch items
        // that already enqueued successfully must stay PENDING so workers can
        // run them — rolling them back to FAILED leaves orphan running jobs.
        const onlyFailedIds = Array.from(new Set(failedTaskIds));
        const succeededIds = createdTaskIds.filter((id) => !onlyFailedIds.includes(id));
        await Promise.allSettled(
          onlyFailedIds.map((id) =>
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
        await auditUserAction(session.userId, "download.dispatch_failed", {
          taskId: dispatchError.taskId,
          taskIds: onlyFailedIds,
          succeededTaskIds: succeededIds,
          errorMessage: dispatchError.message,
          relayMode: relayMode ?? false,
          isBatch: isBatch ?? false,
        }, undefined, session?.currentTeamId);
        return NextResponse.json(
          {
            error: t("apiDownloads.createFailedWithMessage", locale).replace("{message}", dispatchError.message),
            code: "DOWNLOAD_DISPATCH_FAILED",
            taskIds: onlyFailedIds,
            succeededTaskIds: succeededIds,
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
