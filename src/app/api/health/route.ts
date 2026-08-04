import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { collectAllHealth, getMetricHistory } from "@/lib/health/service";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import type { SessionPayload } from "@/lib/auth/session";

import { apiError } from "@/lib/http/api-error";
export const dynamic = "force-dynamic";

function parseHistoryHours(value: string | null) {
  const parsed = Number.parseInt(value ?? "24", 10);
  if (!Number.isFinite(parsed)) return 24;
  return Math.min(Math.max(parsed, 1), 168);
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "health:read", errorMessage: "Failed to fetch health data" },
    async ({ session }) => handleHealthRequest(request, session),
  );
}

async function handleHealthRequest(request: Request, session: SessionPayload | null) {
  const { historyFor, hours } = parseSearchParams(
    request,
    z.object({
      historyFor: z.string().trim().min(1).optional(),
      hours: z
        .string()
        .trim()
        .optional()
        .transform((value) => (value ? parseHistoryHours(value) : undefined)),
    }),
  );

  if (historyFor) {
    if (!session) {
      return apiError({ code: "AUTH_REQUIRED", message: "Unauthorized", status: 401 });
    }
    const access = await assertServerTeamAccess(session, historyFor);
    if (!access.ok) return access.response;
    const history = await getMetricHistory(historyFor, hours);
    const serialized = history.map((h) => ({
      cpu: h.cpuUsage,
      mem: h.memUsage,
      disk: h.diskUsage,
      online: h.isOnline,
      t: h.createdAt.toISOString(),
    }));
    return NextResponse.json({
      history: serialized,
      windowHours: hours ?? 24,
      latestSampleAt: serialized.at(-1)?.t ?? null,
      samplingIntervalSeconds: 300,
    });
  }

  if (!session) {
    return apiError({ code: "AUTH_REQUIRED", message: "Unauthorized", status: 401 });
  }

  const overview = await collectAllHealth(session);
  return NextResponse.json(overview);
}
