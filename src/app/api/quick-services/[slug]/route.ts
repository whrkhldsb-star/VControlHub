import { NextResponse } from "next/server";
import { z } from "zod";
import { startService, stopService, uninstallService, syncServiceStatus, updateService } from "@/lib/quick-service/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const serviceActionSchema = z.object({ action: z.enum(["start", "stop", "sync", "update"]) });

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	return withApiRoute(request, { permission: "docker:manage", rateLimit: GENERAL_WRITE_LIMIT }, async () => {
		const { slug } = await params;
		const parsed = serviceActionSchema.safeParse(await request.json());
		if (!parsed.success) return NextResponse.json({ error: "输入参数无效，支持: start/stop/sync" }, { status: 400 });
		const { action } = parsed.data;

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
		if (action === "update") {
			const result = await updateService(slug);
			return NextResponse.json({ success: true, status: result.status, health: result.health, logTail: result.logTail, updated: true });
		}

		return NextResponse.json({ error: "未知操作，支持: start/stop/sync/update" }, { status: 400 });
	});
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	return withApiRoute(request, { permission: "docker:manage", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: "卸载失败" }, async () => {
		const { slug } = await params;
		await uninstallService(slug);
		return NextResponse.json({ success: true });
	});
}
