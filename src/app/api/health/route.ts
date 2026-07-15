import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyBearerToken } from "@/lib/auth/bearer-token";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { collectAllHealth, getMetricHistory } from "@/lib/health/service";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import type { SessionPayload } from "@/lib/auth/session";
import type { RoleKey } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";

import { apiError } from "@/lib/http/api-error";
export const dynamic = "force-dynamic";

function parseHistoryHours(value: string | null) {
  const parsed = Number.parseInt(value ?? "24", 10);
  if (!Number.isFinite(parsed)) return 24;
  return Math.min(Math.max(parsed, 1), 168);
}

async function buildBearerSession(userId: string): Promise<SessionPayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      mustChangePassword: true,
      currentTeamId: true,
      roles: { select: { role: { select: { key: true } } } },
    },
  });
  if (!user) return null;
  return {
    userId: user.id,
    username: user.username,
    mustChangePassword: user.mustChangePassword,
    currentTeamId: user.currentTeamId,
    roles: user.roles.map(({ role }) => role.key as RoleKey),
  };
}

export async function GET(request: Request) {
  const hasBearerHeader = /^Bearer\s+.+$/i.test(
    request.headers.get("authorization") ?? "",
  );
  if (hasBearerHeader) {
    const tokenAuth = await verifyBearerToken(request, "health:read");
    if (!tokenAuth)
      return apiError({ code: "AUTH_REQUIRED", message: "Unauthorized", status: 401 });
    const tokenSession = await buildBearerSession(tokenAuth.userId);
    return handleHealthRequest(request, tokenSession);
  }

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
    try {
      if (session) {
        const access = await assertServerTeamAccess(session, historyFor);
        if (!access.ok) return access.response;
      }
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
    overview = await collectAllHealth(session ?? undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to collect health data: ${message}` },
      { status: 500 },
    );
  }

  return NextResponse.json(overview);
}
