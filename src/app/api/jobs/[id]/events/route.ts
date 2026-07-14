import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { prisma } from "@/lib/db";
import { listJobEvents } from "@/lib/job/events";
import { teamWhere } from "@/lib/auth/team-scope";
import { sessionHasPermission } from "@/lib/auth/authorization";

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
    { permission: "task:read", errorMessage: "Failed to fetch task events" },
    async ({ session }) => {
      const { id: rawId } = await params;
      const id = rawId?.trim();
      if (!id) {
        throw new ValidationError("Missing task ID");
      }
      const teamScope = teamWhere(session!);
      const where = sessionHasPermission(session!, "team:manage")
        ? { id, ...teamScope }
        : { AND: [{ id }, teamScope, { createdBy: session!.userId }] };
      const job = await prisma.job.findFirst({ where, select: { id: true } });
      if (!job) {
        throw new NotFoundError("Task not found");
      }
      const { limit, beforeId } = parseSearchParams(
        request,
        z.object({
          limit: z
            .string()
            .trim()
            .optional()
            .transform((value) => (value ? parseLimit(value) : undefined)),
          beforeId: z.string().trim().min(1).optional(),
        }),
      );
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
