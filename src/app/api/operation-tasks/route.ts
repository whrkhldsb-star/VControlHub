import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { listOperationTasks } from "@/lib/operation-task/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "task:read", errorMessage: "获取任务列表失败" },
    async () => {
      const limit = Number(
        new URL(request.url).searchParams.get("limit") ?? "100",
      );
      return NextResponse.json({
        tasks: await listOperationTasks({
          limit: Math.min(Math.max(limit || 100, 1), 200),
        }),
      });
    },
  );
}
