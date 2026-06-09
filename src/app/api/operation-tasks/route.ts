import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { listOperationTaskResult, type OperationTask, type OperationTaskListSort, type OperationTaskStatus } from "@/lib/operation-task/service";

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

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function taskToCsvRow(task: OperationTask) {
  return [
    task.id,
    task.source,
    task.sourceId,
    task.taskType,
    task.status,
    task.title,
    task.actor,
    task.createdAt,
    task.updatedAt,
    task.progress,
    task.logPreview?.join("\n"),
    task.foldedCount,
    task.href,
  ].map(csvCell).join(",");
}

function operationTasksCsv(tasks: OperationTask[]) {
  const header = ["id", "source", "sourceId", "taskType", "status", "title", "actor", "createdAt", "updatedAt", "progress", "logPreview", "foldedCount", "href"].join(",");
  return [header, ...tasks.map(taskToCsvRow)].join("\n");
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
      const result = await listOperationTaskResult({
        limit,
        status: parseStatusFilter(searchParams.get("status")),
        taskType: parseTaskTypeFilter(searchParams.get("taskType")),
        sort: parseSort(searchParams.get("sort")),
      });
      if (searchParams.get("format") === "csv") {
        return new Response(operationTasksCsv(result.tasks), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="operation-tasks.csv"',
            "cache-control": "no-store",
          },
        });
      }
      return NextResponse.json(result);
    },
  );
}
