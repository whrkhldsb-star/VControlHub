import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueQuickServiceJob } from "@/lib/quick-service/job-worker";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const serviceActionSchema = z.object({ action: z.enum(["start", "stop", "sync", "update"]) });
const uninstallSchema = z.object({ deleteVolumes: z.boolean().optional() }).optional();

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	return withApiRoute(request, { permission: "docker:manage", rateLimit: GENERAL_WRITE_LIMIT }, async ({ session }) => {
		const { slug } = await params;
		const parsed = serviceActionSchema.safeParse(await request.json());
		if (!parsed.success) return NextResponse.json({ error: "输入参数无效，支持: start/stop/sync/update" }, { status: 400 });
		const { action } = parsed.data;
		const { job, taskId } = await enqueueQuickServiceJob({
			title: `QuickService ${action}: ${slug}`,
			createdBy: session?.userId ?? null,
			payload: { action, slug },
		});
		return NextResponse.json({
			success: true,
			queued: true,
			jobId: job.id,
			taskId,
			status: job.status,
			message: "QuickService 操作已加入后台任务，可在任务中心查看进度。",
		}, { status: 202 });
	});
}

async function readOptionalJson(request: Request) {
	const text = await request.text();
	if (!text.trim()) return undefined;
	return JSON.parse(text) as unknown;
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	return withApiRoute(request, { permission: "docker:manage", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: "卸载失败" }, async ({ session }) => {
		const { slug } = await params;
		const parsed = uninstallSchema.safeParse(await readOptionalJson(request));
		if (!parsed.success) return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
		const deleteVolumes = parsed.data?.deleteVolumes === true;
		const { job, taskId } = await enqueueQuickServiceJob({
			title: `卸载快捷服务：${slug}`,
			createdBy: session?.userId ?? null,
			payload: { action: "uninstall", slug, deleteVolumes },
		});
		return NextResponse.json({
			success: true,
			queued: true,
			jobId: job.id,
			taskId,
			status: job.status,
			deleteVolumes,
			message: "QuickService 卸载已加入后台任务，可在任务中心查看进度。",
		}, { status: 202 });
	});
}
