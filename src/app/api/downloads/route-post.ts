import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { auditUserAction } from "@/lib/audit/service";
import { enqueueDownloadExecutionJob } from "@/lib/downloads/execution-worker";
import { assertDownloadSourceUrlSafe } from "@/lib/downloads/source-url";
import type { DownloadSourceResolution } from "@/lib/downloads/source-url";
import {
  deriveDownloadFileNameFromUrl, normalizeDownloadFileName,
  isMagnetLink,
} from "@/lib/downloads/helpers";
import {
  getDownloadTargetRelativePath,
  resolveDownloadTargetPath,
} from "@/lib/downloads/target-path";
import { downloadWriteCapacity } from "@/lib/downloads/write-capacity";
import { STORAGE_ACCESS_DENIED_REASONS, assertStorageAccess, largestAllowedWrite } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { NotFoundError } from "@/lib/errors";
import { teamCreateData } from "@/lib/auth/team-scope";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/http/error-message";

/* ── POST: Create download task ───────────────────────────── */

/**
 * Upper bound for one batch request. Every URL costs a DNS resolution
 * (assertDownloadSourceUrlSafe), a downloadTask row and a durable job — an
 * unbounded array would hold the request open arbitrarily long and flood the
 * job table from a single call. The UI submits batches well below this.
 */
const MAX_BATCH_URLS = 50;

const postDownloadSchema = z.object({
  url: z.string().url(t("apiDownloads.urlInvalid", "en")),
  storageNodeId: z.string().min(1).optional(),
  serverId: z.string().min(1, t("apiDownloads.missingServerId", "en")),
  targetPath: z.string().min(1, t("apiDownloads.missingTargetPath", "en")),
  fileName: z.string().optional(),
  category: z.string().optional(),
  maxSpeedKb: z.number().int().min(0).max(10_000_000).optional(),
  isBatch: z.boolean().optional(),
  batchUrls: z.array(z.string().trim().min(1).max(2048)).max(MAX_BATCH_URLS, "Too many URLs in one batch request").optional(),
});

export async function POST(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("apiDownloads.createTaskFailed", locale),
      bodySchema: postDownloadSchema,
    },
    async ({ session, body }) => {
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

      // Dedupe: identical links in one paste would each burn a DNS lookup,
      // a task row and a durable job for the same result.
      const allUrls = isBatch && batchUrls?.length
        ? Array.from(new Set(batchUrls))
        : [url];
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
      // Whether the caller may use this server is settled before any DNS work on
      // their links (A5-14): up to fifty lookups used to run for a server the
      // caller could not even see.
      const teamAccess = await assertServerTeamAccess(session, serverId, "connect");
      if (!teamAccess.ok) return teamAccess.response;

      const sourceResolutions = new Map<string, DownloadSourceResolution>();
      // A link stored differently from how it was pasted: a magnet with its unsafe trackers dropped.
      const storedUrls = new Map<string, string>();
      for (const u of allUrls) {
        const validation = await assertDownloadSourceUrlSafe(u);
        if (!validation.ok) {
          return NextResponse.json(
            { error: validation.reason },
            { status: 400 },
          );
        }
        if (validation.resolution) {
          sourceResolutions.set(u, validation.resolution);
        }
        if (validation.url && validation.url !== u) storedUrls.set(u, validation.url);
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { sshKey: true, storageNode: true, agentFileShares: { orderBy: { storageNodeId: "asc" }, select: { node: true, rootIdentity: true } } },
      });
      if (!server)
        throw new NotFoundError(t("apiDownloads.serverNotFound", locale));
      const agentDrives = server.managementMode === "AGENT"
        ? (server.agentFileShares ?? []).map(share => share.node).filter(node => node.driver === "AGENT" && node.teamId === server.teamId) : [];
      const storageNode = body.storageNodeId
        ? [server.storageNode, ...agentDrives].find(node => node?.id === body.storageNodeId)
        : server.storageNode ?? (agentDrives.length === 1 ? agentDrives[0] : null);
      if (!storageNode) {
        return NextResponse.json({ error: t(agentDrives.length ? "apiDownloads.selectDrive" : "apiDownloads.serverMissingStorage", locale) }, { status: 400 });
      }
      if (storageNode.driver !== "AGENT" && !server.sshKey && !server.password && (server.managementMode !== "AGENT" || hasMagnet))
        return NextResponse.json({ error: t("apiDownloads.serverMissingCredentials", locale) }, { status: 400 });

      let resolvedTargetPath: string;
      let targetRelativePath: string;
      try {
        resolvedTargetPath = resolveDownloadTargetPath(
          storageNode.basePath,
          targetPath,
        );
        targetRelativePath = getDownloadTargetRelativePath(
          storageNode.basePath,
          resolvedTargetPath,
        );
      } catch (error) {
        return NextResponse.json(
          {
            error: getErrorMessage(error, t("apiDownloads.invalidTargetPath", locale)),
          },
          { status: 400 },
        );
      }

      const accessDecision = await assertStorageAccess({
        session,
        storageNodeId: storageNode.id,
        relativePath: targetRelativePath,
        operation: "write",
      });
      if (!accessDecision.allowed) {
        return NextResponse.json(
          { error: storageAccessDeniedCopy(accessDecision.reason, locale) },
          { status: 403 },
        );
      }
      let safeFileName: string | null;
      try {
        safeFileName = normalizeDownloadFileName(fileName);
      } catch (error) {
        return NextResponse.json(
          { error: getErrorMessage(error, t("apiDownloads.invalidFileName", locale)) },
          { status: 400 },
        );
      }

      const relayMode = hasMagnet || storageNode.driver === "AGENT";

      // Determine the list of URLs that each become their own task.
      //  - HTTP batch: one task per URL.
      //  - Single HTTP or magnet relay: a single task (magnet relay may carry
      //    multiple magnet URLs into one aria2 task, handled below).
      const taskUrls = isHttpBatch ? allUrls : [allUrls[0]!];
      for (const taskUrl of taskUrls) {
        const name = (!isHttpBatch && safeFileName) || (isMagnetLink(taskUrl) ? null : deriveDownloadFileNameFromUrl(taskUrl) || "download");
        // The size is only known as the download runs, where the worker holds
        // it to these limits; a destination with no room at all is refused now.
        const capacity = await downloadWriteCapacity({
          session,
          storageNodeId: storageNode.id,
          relativePath: targetRelativePath,
        }, name);
        if (largestAllowedWrite(capacity) === BigInt(0) && !("replacing" in capacity)) {
          return NextResponse.json(
            { error: storageAccessDeniedCopy(STORAGE_ACCESS_DENIED_REASONS.quotaExceeded, locale) },
            { status: 403 },
          );
        }
      }
      // A download lands on exactly one server, so in the all-customers view it is recorded under that
      // server's customer instead of asking for one to be chosen first. A server without a customer still
      // needs the choice (teamCreateData refuses).
      const downloadTeamId = session.currentTeamId ?? server.teamId ?? teamCreateData(session).teamId ?? null;

      const agentRootIdentity = server.agentFileShares?.find(share => share.node.id === storageNode.id)?.rootIdentity;
      if (storageNode.driver === "AGENT" && !agentRootIdentity?.startsWith("v2:")) {
        return NextResponse.json({ error: t("backend.fileAgent.unavailable", locale) }, { status: 409 });
      }
      const createdTaskIds: string[] = [];
      // Each URL commits its task and executor together. Earlier batch items keep their own jobs.
      let dispatchError: string | null = null;

      for (const taskUrl of taskUrls) {
        const taskFileName = isHttpBatch ? null : safeFileName;
        let task;
        try {
          task = await prisma.$transaction(async tx => {
            const row = await tx.downloadTask.create({
              data: {
                url: storedUrls.get(taskUrl) ?? taskUrl,
                serverId,
                ...(storageNode.driver === "AGENT" ? { agentStorageNodeId: storageNode.id, agentRootIdentity } : { directStorageNodeId: storageNode.id }),
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
                teamId: downloadTeamId,
              },
            });
            await enqueueDownloadExecutionJob({
              mode: relayMode ? "aria2_relay" : "direct", taskId: row.id, userId: session.userId,
              teamId: downloadTeamId, storageNodeId: storageNode.id, sourceResolution: sourceResolutions.get(taskUrl),
            }, tx);
            return row;
          });
          createdTaskIds.push(task.id);
        } catch (error) {
          dispatchError = getErrorMessage(error, t("apiDownloads.enqueueFailed", locale));
          logError("[DownloadAPI] Download transaction failed", error);
          break;
        }

        await auditUserAction(session.userId, "download.create", {
          url: storedUrls.get(taskUrl!) ?? taskUrl!,
          serverId,
          targetPath: resolvedTargetPath,
          taskId: task.id,
          relayMode: relayMode ?? false,
          category: category ?? "",
          isBatch: isBatch ?? false,
        }, undefined, downloadTeamId);
      }

      if (dispatchError) {
        const succeededIds = createdTaskIds;
        await auditUserAction(session.userId, "download.dispatch_failed", {
          taskId: null,
          taskIds: [],
          succeededTaskIds: succeededIds,
          errorMessage: dispatchError,
          relayMode: relayMode ?? false,
          isBatch: isBatch ?? false,
        }, undefined, downloadTeamId);
        return NextResponse.json(
          {
            error: t("apiDownloads.createFailedWithMessage", locale, { message: dispatchError }),
            code: "DOWNLOAD_DISPATCH_FAILED",
            taskIds: [],
            succeededTaskIds: succeededIds,
            remainingUrls: taskUrls.slice(succeededIds.length),
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
