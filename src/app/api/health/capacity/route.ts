/**
 * GET /api/health/capacity
 *
 * Cross-node capacity prediction from MetricSnapshot history.
 * Permission: health:read. Team-scoped via session.
 *
 * Query:
 *   windowHours  — lookback window (default 168, max 720)
 *   horizonDays  — projection horizon (default 14, max 90)
 *   serverId     — optional single-server filter
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { getCapacityForecast } from "@/lib/health/capacity-service";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  windowHours: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number.parseInt(v, 10) : undefined))
    .refine((v) => v === undefined || (Number.isFinite(v) && v >= 24 && v <= 720), {
      message: "windowHours must be 24–720",
    }),
  horizonDays: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number.parseInt(v, 10) : undefined))
    .refine((v) => v === undefined || (Number.isFinite(v) && v >= 1 && v <= 90), {
      message: "horizonDays must be 1–90",
    }),
  serverId: z.string().trim().min(1).optional(),
});

export async function GET(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "health:read",
      querySchema,
      errorMessage: "Failed to compute capacity forecast",
    },
    async ({ session, query }) => {
      if (query.serverId && session) {
        const access = await assertServerTeamAccess(session, query.serverId);
        if (!access.ok) return access.response;
      }

      const result = await getCapacityForecast({
        windowHours: query.windowHours,
        horizonDays: query.horizonDays,
        serverId: query.serverId,
        session: session ?? undefined,
      });

      return NextResponse.json(result);
    },
  );
}
