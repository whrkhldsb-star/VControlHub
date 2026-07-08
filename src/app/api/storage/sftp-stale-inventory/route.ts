/**
 * TR-005 T34a: SFTP 远端索引定期校验 API 入口。
 *
 * POST /api/storage/sftp-stale-inventory
 * Body: {
 *   nodeId?: string;        // 不传 = 扫所有 SFTP 节点
 *   maxDepth?: number;      // 默认 5
 *   dryRun?: boolean;       // 默认 false
 *   reason?: string;        // 操作上下文, 落到 job title
 * }
 *
 * 行为:
 * - 默认异步: enqueue durable job, 返 202 + jobId
 * - wait=1 query: 同步执行, 返 200 + 结果 (debug / 手动验证用)
 *
 * 权限: storage:manage-node (跟节点管理一致, 给管理员触发)
 */
import { NextRequest, NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";
import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
import { listSftpNodesForStaleInventory, detectAndPruneSftpStaleInventory } from "@/lib/storage/sftp-stale-inventory";
import { SFTP_STALE_INVENTORY_JOB_TYPE } from "@/lib/storage/sftp-stale-inventory-job";
import {
  sftpStaleInventoryBodySchema,
  sftpWaitQuerySchema,
  type SftpStaleInventoryBody as SharedSftpStaleInventoryBody,
} from "@/lib/storage/schema";

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
    { permission: "storage:manage-node", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session, body }) => {
      if (!session) throw new AuthError("Not authenticated");
      const input = (body ?? {}) as StaleInventoryInput;
      const parsed = staleInventorySchema.safeParse(input);
      if (!parsed.success) throw new ValidationError("Invalid input parameter");
      const data = parsed.data;

      const { wait } = parseSearchParams(request, sftpWaitQuerySchema);

      if (data.nodeId) {
        const nodes = await listSftpNodesForStaleInventory();
        const target = nodes.find((n) => n.id === data.nodeId);
        if (!target) throw new NotFoundError("Storage node not found");
      }

      if (wait) {
        const result = data.nodeId
          ? await scanOneNode(data)
          : await scanAllNodes(data);
        return NextResponse.json({
          success: true,
          queued: false,
          ...summarize([result]),
          results: [result],
        });
      }

      const job = await enqueueJob({
        type: SFTP_STALE_INVENTORY_JOB_TYPE,
        title: data.nodeId
          ? `SFTP stale inventory: ${data.nodeId}`
          : "SFTP stale inventory: all nodes",
        payload: {
          nodeId: data.nodeId,
          maxDepth: data.maxDepth,
          dryRun: data.dryRun,
          reason: data.reason ?? "api",
        },
        createdBy: session.userId,
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
          message: "SFTP stale inventory has been added as a background task, you can check progress in the task center.",
        },
        { status: 202 },
      );
    },
  );
}

async function scanOneNode(input: StaleInventoryInput) {
  const nodes = await listSftpNodesForStaleInventory();
  const node = nodes.find((n) => n.id === input.nodeId);
  if (!node) throw new NotFoundError("Storage node not found");
  return detectAndPruneSftpStaleInventory({
    node: node as unknown as Parameters<typeof detectAndPruneSftpStaleInventory>[0]["node"],
    maxDepth: input.maxDepth,
    dryRun: input.dryRun,
  });
}

async function scanAllNodes(input: StaleInventoryInput) {
  const nodes = await listSftpNodesForStaleInventory();
  if (nodes.length === 0) {
    return {
      nodeId: "all",
      nodeName: "(no SFTP nodes)",
      basePath: "",
      scanned: 0,
      stale: 0,
      errors: [],
      durationMs: 0,
      dryRun: input.dryRun ?? false,
    };
  }
  // wait=1 同步入口: 只返首个节点的结果 (避免超时), 其它走 enqueue 异步
  const first = nodes[0];
  return detectAndPruneSftpStaleInventory({
    node: first as unknown as Parameters<typeof detectAndPruneSftpStaleInventory>[0]["node"],
    maxDepth: input.maxDepth,
    dryRun: input.dryRun,
  });
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
