import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { collectAllHealth, getMetricHistory } from "@/lib/health/service";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import type { SessionPayload } from "@/lib/auth/session";
import { config } from "@/lib/config/env";
import { createSingleFlight } from "@/lib/concurrency/single-flight";
import type { HealthOverview } from "@/lib/health/service-types";

export const dynamic = "force-dynamic";

/**
 * One health sweep opens a TCP probe + SSH session per managed server. With N
 * dashboard tabs polling on their own interval, N sweeps ran concurrently —
 * a fleet of 50 servers behind 10 tabs meant 500 SSH sessions per tick.
 * Single-flight collapses concurrent callers onto one sweep and reuses its
 * result for a short TTL; failures are never cached, so a broken sweep does
 * not stick.
 *
 * Keys are per user + team + role set, so a cached overview can never be
 * served to a caller with different visibility.
 */
const healthOverviewFlight = createSingleFlight<HealthOverview>({
	ttlMs: () => config.health.overviewCacheTtlMs,
	maxKeys: 128,
});

function healthOverviewKey(session: SessionPayload): string {
	return [
		session.userId,
		session.currentTeamId ?? "-",
		[...session.roles].sort().join(","),
	].join("|");
}

function parseHistoryHours(value: string | null) {
  const parsed = Number.parseInt(value ?? "24", 10);
  if (!Number.isFinite(parsed)) return 24;
  return Math.min(Math.max(parsed, 1), 168);
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "health:read", errorMessage: apiCopy("apiCopy.failed.to.fetch.health.data.aa2a84de") },
    async ({ session }) => handleHealthRequest(request, session),
  );
}

async function handleHealthRequest(request: Request, session: SessionPayload) {
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

  const overview = await healthOverviewFlight.run(healthOverviewKey(session), () =>
    collectAllHealth(session),
  );
  return NextResponse.json(overview);
}
