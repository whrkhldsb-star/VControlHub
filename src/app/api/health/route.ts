import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { collectAllHealth, getMetricHistory, snapshotMetrics } from "@/lib/health/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	try {
		await requireSession();
	} catch {
		return NextResponse.json({ error: "未认证" }, { status: 401 });
	}

	const { searchParams } = new URL(request.url);
	const historyFor = searchParams.get("historyFor");
	const hours = parseInt(searchParams.get("hours") ?? "24", 10);

	if (historyFor) {
		const history = await getMetricHistory(historyFor, hours);
		const serialized = history.map((h) => ({
			cpu: h.cpuUsage,
			mem: h.memUsage,
			disk: h.diskUsage,
			online: h.isOnline,
			t: h.createdAt.toISOString(),
		}));
		return NextResponse.json({ history: serialized });
	}

	const overview = await collectAllHealth();

	// Snapshot metrics for history (best-effort, don't block response)
	for (const s of overview.servers) {
		if (s.enabled && s.cpu !== undefined) {
			snapshotMetrics(s.serverId, s.cpu, s.mem ?? 0, s.diskMax ?? 0, s.status !== "offline").catch(() => {});
		}
	}

	return NextResponse.json(overview);
}
