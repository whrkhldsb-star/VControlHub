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

const MAX_LIMIT = 500;

/**
 * `limit` is validated rather than silently clamped: the old `parseLimit` turned
 * `?limit=abc` into 100, so a caller with a broken query string got a plausible
 * page instead of being told. Out-of-range and non-numeric values are now the
 * same 400 every other list route returns. Omitting it — or passing `?limit=`,
 * which the old code also treated as absent — still falls back to
 * `listJobEvents`' own default.
 */
const eventsQuerySchema = z.object({
  limit: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  ),
  beforeId: z.string().trim().min(1).optional(),
});

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
      const { limit, beforeId } = parseSearchParams(request, eventsQuerySchema);
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
