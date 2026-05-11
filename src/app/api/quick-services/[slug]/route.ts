import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { startService, stopService, uninstallService, syncServiceStatus, getQuickService } from "@/lib/quick-service/service";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage"))
			return NextResponse.json({ error: "权限不足" }, { status: 403 });

		const { slug } = await params;
		const body = await request.json();
		const action = (body.action ?? "").trim();

		if (action === "start") {
			await startService(slug);
			return NextResponse.json({ success: true, status: "running" });
		}
		if (action === "stop") {
			await stopService(slug);
			return NextResponse.json({ success: true, status: "stopped" });
		}
		if (action === "sync") {
			const status = await syncServiceStatus(slug);
			return NextResponse.json({ success: true, status });
		}

		return NextResponse.json({ error: "未知操作，支持: start/stop/sync" }, { status: 400 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : "操作失败";
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	try {
		const session = await requireSession();
		if (!sessionHasPermission(session, "user:manage"))
			return NextResponse.json({ error: "权限不足" }, { status: 403 });

		const { slug } = await params;
		await uninstallService(slug);
		return NextResponse.json({ success: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : "卸载失败";
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}
