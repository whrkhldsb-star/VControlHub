import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { listOperationTaskResult, type OperationTaskListSort, type OperationTaskStatus } from "@/lib/operation-task/service";

const allowedStatuses = new Set<OperationTaskStatus>(["pending", "running", "completed", "failed", "cancelled", "paused"]);
const allowedSorts = new Set<OperationTaskListSort>(["recent", "attention"]);

function parseStatusFilter(value: string | null): OperationTaskStatus | OperationTaskStatus[] | undefined {
  if (!value) return undefined;
  const statuses = value.split(",").map((item) => item.trim()).filter(Boolean);
  const validStatuses = statuses.filter((item): item is OperationTaskStatus => allowedStatuses.has(item as OperationTaskStatus));
  if (validStatuses.length === 0) return undefined;
  return validStatuses.length === 1 ? validStatuses[0] : validStatuses;
}

function parseTaskTypeFilter(value: string | null) {
  const taskType = value?.trim();
  return taskType || undefined;
}

function parseSort(value: string | null): OperationTaskListSort | undefined {
  if (!value) return undefined;
  return allowedSorts.has(value as OperationTaskListSort) ? value as OperationTaskListSort : undefined;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "task:read", errorMessage: "获取任务列表失败" },
    async () => {
      const searchParams = new URL(request.url).searchParams;
      const limitParam = searchParams.get("limit");
      const limit = limitParam === null ? undefined : Number(limitParam);
      return NextResponse.json(await listOperationTaskResult({
        limit,
        status: parseStatusFilter(searchParams.get("status")),
        taskType: parseTaskTypeFilter(searchParams.get("taskType")),
        sort: parseSort(searchParams.get("sort")),
      }));
    },
  );
}
