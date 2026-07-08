import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";
import { SFTP_SYNC_JOB_TYPE } from "@/lib/storage/sftp-sync-job";

import { assertStorageAccess } from "@/lib/storage/access-control";
import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  getSftpSyncNode,
  syncSftpDirectoryEntries,
} from "@/lib/storage/sftp-sync";
import {
  normalizeRemotePath,
  toClientStorageError,
} from "@/lib/storage/remote-path";
import {
  sftpSyncBodySchema,
  sftpWaitQuerySchema,
} from "@/lib/storage/schema";

export const dynamic = "force-dynamic";

// `sftpSyncSchema` and the inline `wait` query schema have been migrated
// to the shared boundary in `src/lib/storage/schema.ts`. Behaviour is
// identical to the previous inline version.
const sftpSyncSchema = sftpSyncBodySchema;

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:write", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: sftpSyncSchema },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Not authenticated");

      const {
        nodeId,
        remotePath,
        recursive = false,
        maxDepth = 1,
      } = body;

      const node = await getSftpSyncNode(nodeId);
      if (!node) {
        throw new NotFoundError("Storage node not found");
      }
      if (node.driver !== "SFTP") {
        return NextResponse.json(
          { error: "This node is not an SFTP storage node" },
          { status: 400 },
        );
      }

      try {
        normalizeRemotePath(node.basePath, remotePath);
      } catch {
        return NextResponse.json(
          toClientStorageError("Sync path exceeds the storage node root directory"),
          { status: 400 },
        );
      }

      const accessDecision = await assertStorageAccess({
        session,
        storageNodeId: node.id,
        relativePath: remotePath,
        operation: "write",
      });
      if (!accessDecision.allowed) {
        return NextResponse.json(
          { error: accessDecision.reason ?? "Missing storage access authorization" },
          { status: 403 },
        );
      }

      const { wait } = parseSearchParams(request, sftpWaitQuerySchema);
      const waitForCompletion = wait;
      if (waitForCompletion) {
        try {
          const result = await syncSftpDirectoryEntries({
            node,
            remotePath,
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
            { error: error instanceof Error ? error.message : "SyncFailed" },
            { status: 400 },
          );
        }
      }

      const job = await enqueueJob({
        type: SFTP_SYNC_JOB_TYPE,
        title: `SFTP Sync: ${node.name}`,
        payload: { nodeId, remotePath, recursive, maxDepth },
        createdBy: session.userId,
        maxAttempts: 3,
      });
      return NextResponse.json({
        success: true,
        queued: true,
        jobId: job.id,
        taskId: `job:${job.id}`,
        status: job.status,
        message: "SFTP sync has been added as a background task, you can check progress in the task center.",
      }, { status: 202 });
    },
  );
}
