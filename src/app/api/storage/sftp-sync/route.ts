import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";
import { SFTP_SYNC_JOB_TYPE } from "@/lib/storage/sftp-sync-job";

import { assertStorageAccess } from "@/lib/storage/access-control";
import { AuthError, NotFoundError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
import {
  getSftpSyncNode,
  syncSftpDirectoryEntries,
} from "@/lib/storage/sftp-sync";
import {
  normalizeRemotePath,
  normalizeRemoteRelativePath,
  toClientStorageError,
} from "@/lib/storage/remote-path";
import {
  sftpSyncBodySchema,
  sftpWaitQuerySchema,
} from "@/lib/storage/schema";
import { getErrorMessage } from "@/lib/http/error-message";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

// `sftpSyncSchema` and the inline `wait` query schema have been migrated
// to the shared boundary in `src/lib/storage/schema.ts`. Behaviour is
// identical to the previous inline version.
const sftpSyncSchema = sftpSyncBodySchema;

export async function POST(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    { permission: "storage:write", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: sftpSyncSchema },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError(t("api.auth.sessionExpired", locale));

      const {
        nodeId,
        remotePath,
        recursive = false,
        maxDepth = 1,
      } = body;

      const node = await getSftpSyncNode(nodeId, session);
      if (!node) {
        throw new NotFoundError(t("api.storage.localEntryNotFound", locale));
      }
      if (node.driver !== "SFTP") {
        return NextResponse.json(
          { error: t("api.storage.sftp.notSftpNode", locale) },
          { status: 400 },
        );
      }

      // Normalize once so ACL grants, sync work, and job payload all share the same relative path
      // (raw body may include leading slashes / redundant segments that diverge from grant matching).
      let normalizedRelativePath: string;
      try {
        normalizeRemotePath(node.basePath, remotePath);
        normalizedRelativePath = normalizeRemoteRelativePath(remotePath);
      } catch {
        return NextResponse.json(
          toClientStorageError("Sync path exceeds the storage node root directory"),
          { status: 400 },
        );
      }

      const accessDecision = await assertStorageAccess({
        session,
        storageNodeId: node.id,
        relativePath: normalizedRelativePath,
        operation: "write",
      });
      if (!accessDecision.allowed) {
        return NextResponse.json(
          { error: accessDecision.reason ?? t("api.storage.accessDenied", locale) },
          { status: 403 },
        );
      }

      const { wait } = parseSearchParams(request, sftpWaitQuerySchema);
      const waitForCompletion = wait;
      if (waitForCompletion) {
        try {
          const result = await syncSftpDirectoryEntries({
            node,
            remotePath: normalizedRelativePath,
            recursive,
            maxDepth,
          });
          const status = result.errors.length === 0 ? 200 : result.synced > 0 || result.created > 0 || result.updated > 0 || result.deleted > 0 ? 207 : 504;
          return NextResponse.json({
            success: result.errors.length === 0,
            ...result,
          }, { status });
        } catch (error) {
          return NextResponse.json(
            { error: getErrorMessage(error, t("api.storage.sftp.syncFailed", locale)) },
            { status: 400 },
          );
        }
      }

      const job = await enqueueJob({
        type: SFTP_SYNC_JOB_TYPE,
        title: `SFTP Sync: ${node.name}`,
        payload: {
          nodeId,
          remotePath: normalizedRelativePath,
          recursive,
          maxDepth,
          teamId: session.currentTeamId ?? node.teamId ?? null,
        },
        createdBy: session.userId,
        teamId: session.currentTeamId ?? node.teamId ?? null,
        maxAttempts: 3,
      });
      await auditUserAction(session.userId, "storage.sftp-sync", { nodeId, remotePath: normalizedRelativePath || null }, undefined, session?.currentTeamId);
      return NextResponse.json({
        success: true,
        queued: true,
        jobId: job.id,
        taskId: `job:${job.id}`,
        status: job.status,
        message: t("api.storage.sftp.queued", locale),
      }, { status: 202 });
    },
  );
}
