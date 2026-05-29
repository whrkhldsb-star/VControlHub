import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { verifyBearerToken } from "@/lib/auth/bearer-token";
import {
  collectAllHealth,
  getMetricHistory,
  snapshotMetrics,
} from "@/lib/health/service";
import { withApiRoute } from "@/lib/http/api-guard";

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
      return NextResponse.json({ error: "未认证" }, { status: 401 });
    return handleHealthRequest(request);
  }

  return withApiRoute(
    request,
    { requireAuth: true, errorMessage: "健康数据获取失败" },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      if (!sessionHasPermission(session, "health:read")) {
        return NextResponse.json({ error: "缺少权限" }, { status: 403 });
      }
      return handleHealthRequest(request);
    },
  );
}

async function handleHealthRequest(request: Request) {
  const { searchParams } = new URL(request.url);
  const historyFor = searchParams.get("historyFor");
  const hours = parseHistoryHours(searchParams.get("hours"));

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
      const message = err instanceof Error ? err.message : "未知错误";
      return NextResponse.json(
        { error: `健康历史获取失败: ${message}` },
        { status: 500 },
      );
    }
  }

  let overview;
  try {
    overview = await collectAllHealth();
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      { error: `健康数据采集失败: ${message}` },
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
      ).catch(() => {});
    }
  }

  return NextResponse.json(overview);
}
