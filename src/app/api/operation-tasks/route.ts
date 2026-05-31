import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { listOperationTasks } from "@/lib/operation-task/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "task:read", errorMessage: "获取任务列表失败" },
    async () => {
      const limitParam = new URL(request.url).searchParams.get("limit");
      const limit = limitParam === null ? undefined : Number(limitParam);
      return NextResponse.json({
        tasks: await listOperationTasks({ limit }),
      });
    },
  );
}
