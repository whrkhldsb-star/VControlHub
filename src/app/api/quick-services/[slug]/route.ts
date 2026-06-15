import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueQuickServiceJob } from "@/lib/quick-service/job-worker";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { ValidationError } from "@/lib/errors";
const serviceActionSchema = z.object({ action: z.enum(["start", "stop", "sync", "update"]) });
const uninstallSchema = z.object({ deleteVolumes: z.boolean().optional() }).optional();

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	return withApiRoute(request, { permission: "docker:manage", rateLimit: GENERAL_WRITE_LIMIT }, async ({ session }) => {
		const { slug } = await params;
		const parsed = serviceActionSchema.safeParse(await request.json());
		if (!parsed.success) throw new ValidationError("输入参数无效，支持: start/stop/sync/update");
		const { action } = parsed.data;
		const { job, taskId, reused } = await enqueueQuickServiceJob({
			title: `QuickService ${action}: ${slug}`,
			createdBy: session?.userId ?? null,
			payload: { action, slug },
		});
		return NextResponse.json({
			success: true,
			queued: true,
			reused,
			jobId: job.id,
			taskId,
			status: job.status,
			message: reused ? "该服务已有进行中的生命周期任务，已返回现有任务。" : "QuickService 操作已加入后台任务，可在任务中心查看进度。",
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
		if (!parsed.success) throw new ValidationError("输入参数无效");
		const deleteVolumes = parsed.data?.deleteVolumes === true;
		const { job, taskId, reused } = await enqueueQuickServiceJob({
			title: `卸载快捷服务：${slug}`,
			createdBy: session?.userId ?? null,
			payload: { action: "uninstall", slug, deleteVolumes },
		});
		return NextResponse.json({
			success: true,
			queued: true,
			reused,
			jobId: job.id,
			taskId,
			status: job.status,
			deleteVolumes,
			message: reused ? "该服务已有进行中的生命周期任务，已返回现有任务。" : "QuickService 卸载已加入后台任务，可在任务中心查看进度。",
		}, { status: 202 });
	});
}
