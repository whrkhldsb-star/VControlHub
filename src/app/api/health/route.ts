import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { verifyApiToken } from "@/lib/api-token/service";
import { collectAllHealth, getMetricHistory, snapshotMetrics } from "@/lib/health/service";

export const dynamic = "force-dynamic";

async function authorizeWithBearer(request: Request) {
	const authorization = request.headers.get("authorization") ?? "";
	const match = authorization.match(/^Bearer\s+(.+)$/i);
	if (!match) return null;
	const token = await verifyApiToken(match[1].trim());
	if (!token) return { ok: false as const, status: 401, error: "未认证" };
	return token.scopes.includes("health:read")
		? { ok: true as const }
		: { ok: false as const, status: 403, error: "缺少权限" };
}

async function authorizeHealthRead(request: Request) {
	const bearerAuth = await authorizeWithBearer(request);
	if (bearerAuth) return bearerAuth;
	try {
		const session = await requireSession();
		return sessionHasPermission(session, "health:read")
			? { ok: true as const }
			: { ok: false as const, status: 403, error: "缺少权限" };
	} catch {
		return { ok: false as const, status: 401, error: "未认证" };
	}
}

function parseHistoryHours(value: string | null) {
	const parsed = Number.parseInt(value ?? "24", 10);
	if (!Number.isFinite(parsed)) return 24;
	return Math.min(Math.max(parsed, 1), 168);
}

export async function GET(request: Request) {
	const auth = await authorizeHealthRead(request);
	if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
			return NextResponse.json({ error: `健康历史获取失败: ${message}` }, { status: 500 });
		}
	}

	let overview;
	try {
		overview = await collectAllHealth();
	} catch (err) {
		const message = err instanceof Error ? err.message : "未知错误";
		return NextResponse.json({ error: `健康数据采集失败: ${message}` }, { status: 500 });
	}

	// Snapshot metrics for history (best-effort, don't block response)
	for (const s of overview.servers) {
		if (s.enabled && s.cpu !== undefined) {
			snapshotMetrics(s.serverId, s.cpu, s.mem ?? 0, s.diskMax ?? 0, s.status !== "offline").catch(() => {});
		}
	}

	return NextResponse.json(overview);
}
