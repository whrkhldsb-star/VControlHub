import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { prisma } from "@/lib/db";
import { listJobEvents } from "@/lib/job/events";

import { NotFoundError, ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function parseLimit(value: string | null): number {
  if (value === null) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    { permission: "task:read", errorMessage: "获取任务事件失败" },
    async () => {
      const { id: rawId } = await params;
      const id = rawId?.trim();
      if (!id) {
        throw new ValidationError("缺少任务 ID");
      }
      const job = await prisma.job.findUnique({ where: { id }, select: { id: true } });
      if (!job) {
        throw new NotFoundError("任务不存在");
      }
      const { searchParams } = new URL(request.url);
      const limit = parseLimit(searchParams.get("limit"));
      const beforeId = searchParams.get("beforeId")?.trim() || undefined;
      const events = await listJobEvents({ jobId: id, limit, beforeId });
      return NextResponse.json({
        jobId: id,
        events: events.map((event) => ({
          id: event.id,
          jobId: event.jobId,
          type: event.type,
          level: event.level,
          message: event.message,
          workerId: event.workerId,
          payload: event.payload,
          createdAt: event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt,
        })),
      });
    },
  );
}
