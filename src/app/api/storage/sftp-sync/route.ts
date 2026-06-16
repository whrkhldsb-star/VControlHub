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
    { permission: "storage:write", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
      if (!session)
        throw new AuthError("未认证");

      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        throw new ValidationError("无效的请求体");
      }

      const parsed = sftpSyncSchema.safeParse(rawBody);
      if (!parsed.success)
        throw new ValidationError("输入参数无效");
      const {
        nodeId,
        remotePath,
        recursive = false,
        maxDepth = 1,
      } = parsed.data;

      const node = await getSftpSyncNode(nodeId);
      if (!node) {
        throw new NotFoundError("存储节点不存在");
      }
      if (node.driver !== "SFTP") {
        return NextResponse.json(
          { error: "该节点不是 SFTP 类型" },
          { status: 400 },
        );
      }

      try {
        normalizeRemotePath(node.basePath, remotePath);
      } catch {
        return NextResponse.json(
          toClientStorageError("同步路径超出存储节点根目录"),
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
          { error: accessDecision.reason ?? "缺少存储访问授权" },
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
            { error: error instanceof Error ? error.message : "同步失败" },
            { status: 400 },
          );
        }
      }

      const job = await enqueueJob({
        type: SFTP_SYNC_JOB_TYPE,
        title: `SFTP 同步：${node.name}`,
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
        message: "SFTP 同步已加入后台任务，可在任务中心查看进度。",
      }, { status: 202 });
    },
  );
}
