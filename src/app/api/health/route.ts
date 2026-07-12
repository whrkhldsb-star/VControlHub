import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyBearerToken } from "@/lib/auth/bearer-token";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { collectAllHealth, getMetricHistory, snapshotMetrics } from "@/lib/health/service";

import { apiError } from "@/lib/http/api-error";
import { createLogger } from "@/lib/logging";

const healthLogger = createLogger("health-api");
export const dynamic = "force-dynamic";

function parseHistoryHours(value: string | null) {
  const parsed = Number.parseInt(value ?? "24", 10);
  if (!Number.isFinite(parsed)) return 24;
  return Math.min(Math.max(parsed, 1), 168);
}

export async function GET(request: Request) {
  const hasBearerHeader = /^Bearer\s+.+$/i.test(
    request.headers.get("authorization") ?? "",
  );
  if (hasBearerHeader) {
    const tokenAuth = await verifyBearerToken(request, "health:read");
    if (!tokenAuth)
      return apiError({ code: "AUTH_REQUIRED", message: "Unauthorized", status: 401 });
    return handleHealthRequest(request);
  }

  return withApiRoute(
    request,
    { permission: "health:read", errorMessage: "Failed to fetch health data" },
    async () => handleHealthRequest(request),
  );
}

async function handleHealthRequest(request: Request) {
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
    try {
      const history = await getMetricHistory(historyFor, hours);
      const serialized = history.map((h) => ({
        cpu: h.cpuUsage,
        mem: h.memUsage,
        disk: h.diskUsage,
        online: h.isOnline,
        t: h.createdAt.toISOString(),
      }));
      return NextResponse.json({ history: serialized });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json(
        { error: `Failed to fetch health history: ${message}` },
        { status: 500 },
      );
    }
  }

  let overview;
  try {
    overview = await collectAllHealth();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to collect health data: ${message}` },
      { status: 500 },
    );
  }

  // Snapshot metrics for history (best-effort, don't block response)
  for (const s of overview.servers) {
    if (s.enabled && s.cpu !== undefined) {
      snapshotMetrics(
        s.serverId,
        s.cpu,
        s.mem ?? 0,
        s.diskMax ?? 0,
        s.status !== "offline",
      ).catch((err) => { healthLogger.warn("snapshotMetrics failed", { error: err instanceof Error ? err.message : String(err) }); });
    }
  }

  return NextResponse.json(overview);
}
