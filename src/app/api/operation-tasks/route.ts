import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { listOperationTaskResult } from "@/lib/operation-task/service";
import type { OperationTask, OperationTaskListSort, OperationTaskStatus } from "@/lib/operation-task/dto";

const STATUS_VALUES = ["pending", "running", "completed", "failed", "cancelled", "paused"] as const;
const SORT_VALUES = ["recent", "attention"] as const;

/**
 * TR-037 R5+: the route used to inline `new URL(req.url).searchParams` and
 * call `.get()` + manual `.split()` + ad-hoc `Number()` casts. The only
 * validation was a `Set.has()` for the sort enum, and empty strings
 * (`?limit=`) silently coerced to `0`. Replace the ad-hoc block with a
 * `parseSearchParams(...)` zod call so unknown keys surface a unified 400
 * and the route can lean on type-narrowed values.
 *
 * Backward-compat notes:
 *   - `?limit=` still resolves to `undefined` (service falls back to
 *     `configuredLimit`). NaN values are rejected with 400.
 *   - `?status=garbage` still gets silently dropped inside the handler so
 *     dashboards with stale enum values don't break.
 *   - `?sort=oldest` is still silently ignored (legacy contract).
 *   - `?format=xml` (or any value other than `csv` / `json`) is now 400
 *     instead of silently falling through to JSON. The two values that
 *     matter are still accepted.
 */
const operationTasksQuerySchema = z.object({
  limit: z.preprocess(
    (v) => (v === "" || v == null) ? undefined : Number(v),
    z.number().finite().nonnegative().max(9999).optional(),
  ),
  status: z.string().max(256).optional(),
  taskType: z.string().trim().min(1).max(64).optional(),
  sort: z.string().max(32).optional(),
  format: z.enum(["csv", "json"]).optional(),
});

function parseStatusFilter(value: string | null | undefined): OperationTaskStatus | OperationTaskStatus[] | undefined {
  if (!value) return undefined;
  const list = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is OperationTaskStatus => (STATUS_VALUES as readonly string[]).includes(item));
  if (list.length === 0) return undefined;
  return list.length === 1 ? list[0] : list;
}

function parseTaskTypeFilter(value: string | null | undefined) {
  const taskType = value?.trim();
  return taskType || undefined;
}

function parseSort(value: string | null | undefined): OperationTaskListSort | undefined {
  if (!value) return undefined;
  return (SORT_VALUES as readonly string[]).includes(value) ? (value as OperationTaskListSort) : undefined;
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
    { permission: "task:read", errorMessage: "Failed to fetch task list" },
    async () => {
      const q = parseSearchParams(request, operationTasksQuerySchema);
      const result = await listOperationTaskResult({
        limit: q.limit,
        status: parseStatusFilter(q.status),
        taskType: parseTaskTypeFilter(q.taskType),
        sort: parseSort(q.sort),
      });
      if (q.format === "csv") {
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
