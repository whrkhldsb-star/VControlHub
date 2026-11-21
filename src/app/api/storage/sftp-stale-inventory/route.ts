import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * TR-005 T34a: SFTP 远端索引定期校验 API 入口。
 *
 * POST /api/storage/sftp-stale-inventory
 * Body: {
 *   nodeId?: string;        // 不传 = 扫调用方可管理范围内的 SFTP 节点
 *   maxDepth?: number;      // 默认 5
 *   dryRun?: boolean;       // 默认 false
 *   reason?: string;        // 操作上下文, 落到 job title
 * }
 *
 * 行为:
 * - 默认异步: enqueue durable job, 返 202 + jobId
 * - wait=1 query: 同步执行, 返 200 + 结果 (debug / 手动验证用)
 *
 * 权限: storage:manage-node (跟节点管理一致)
 * 租户边界: 所有用户触发路径均经 teamWhere 约束；
 * 系统 worker 周期任务仍可走无 session 全量列表。
 */
import { NextRequest, NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  findSftpNodeForStaleInventory,
  listSftpNodesForStaleInventory,
  detectAndPruneSftpStaleInventory,
} from "@/lib/storage/sftp-stale-inventory";
import { SFTP_STALE_INVENTORY_JOB_TYPE } from "@/lib/storage/sftp-stale-inventory-job";
import {
  sftpStaleInventoryBodySchema,
  sftpWaitQuerySchema,
  type SftpStaleInventoryBody as SharedSftpStaleInventoryBody,
} from "@/lib/storage/schema";
import { auditUserAction } from "@/lib/audit/service";
import { sftpJobScope } from "@/lib/storage/sftp-job-scope";

export const dynamic = "force-dynamic";

// `staleInventorySchema` and the inline `wait` query schema have been
// migrated to the shared boundary in `src/lib/storage/schema.ts`.
// Behaviour is identical to the previous inline version (the `reason`
// field stayed in the shared body schema).
const staleInventorySchema = sftpStaleInventoryBodySchema;
type StaleInventoryInput = SharedSftpStaleInventoryBody;

export async function POST(request: NextRequest) {
  return withApiRoute(
    request,
    // Declared, or the wrapper never reads the body: a dry run of one node
    // ran for real over every node in reach, and queued jobs lost their
    // node, depth and dry-run settings. An empty body still scans all.
    { permission: "storage:manage-node", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: staleInventorySchema.optional() },
    async ({ session, body }) => {
      const input = (body ?? {}) as StaleInventoryInput;
      const parsed = staleInventorySchema.safeParse(input);
      if (!parsed.success) throw new ValidationError(apiCopy("apiCopy.invalid.input.parameter.d64ebcd8"));
      const data = parsed.data;

      const { wait } = parseSearchParams(request, sftpWaitQuerySchema);

      const singleNode = data.nodeId ? await findSftpNodeForStaleInventory(data.nodeId, session) : null;
      if (data.nodeId && !singleNode) throw new NotFoundError(apiCopy("apiCopy.storage.node.not.found.3b3ec488"));
      const nodes = singleNode ? [singleNode] : await listSftpNodesForStaleInventory(session);

      if (wait) {
        // Scan sequentially to limit the load on remote hosts.
        const results = [];
        for (const node of nodes) {
          results.push(await detectAndPruneSftpStaleInventory({ node, maxDepth: data.maxDepth, dryRun: data.dryRun }));
        }
        await auditUserAction(session.userId, "storage.sftp-stale-cleanup", { nodeId: data.nodeId ?? "all", dryRun: data.dryRun ?? false }, undefined, session.currentTeamId);
        return NextResponse.json({
          success: true,
          queued: false,
          ...summarize(results),
          results,
        });
      }

      const job = await enqueueJob({
        type: SFTP_STALE_INVENTORY_JOB_TYPE,
        title: data.nodeId
          ? `SFTP stale inventory: ${data.nodeId}`
          : `SFTP stale inventory: scoped nodes (${nodes.length})`,
        payload: {
          ...sftpJobScope(session, nodes),
          nodeId: data.nodeId,
          nodeIds: data.nodeId ? undefined : nodes.map(node => node.id),
          maxDepth: data.maxDepth,
          dryRun: data.dryRun,
          reason: data.reason ?? "api",
        },
        createdBy: session.userId,
        teamId: session.currentTeamId ?? null,
        maxAttempts: 2,
        targetStorageNodeId: data.nodeId ?? null,
      });
      return NextResponse.json(
        {
          success: true,
          queued: true,
          jobId: job.id,
          taskId: `job:${job.id}`,
          status: job.status,
          message: apiCopy("apiCopy.sftp.stale.inventory.has.been.added.as.a.background.task.you.can.f8a40d74"),
        },
        { status: 202 },
      );
    },
  );
}

function summarize(results: Array<{ stale: number; errors: string[]; scanned: number; durationMs: number }>) {
  return {
    totals: {
      scanned: results.reduce((sum, r) => sum + r.scanned, 0),
      stale: results.reduce((sum, r) => sum + r.stale, 0),
      errors: results.reduce((sum, r) => sum + r.errors.length, 0),
      durationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
    },
  };
}
