import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueQuickServiceJob } from "@/lib/quick-service/job-worker";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const serviceActionSchema = z.object({ action: z.enum(["start", "stop", "sync", "update"]) });
const uninstallSchema = z.object({ deleteVolumes: z.boolean().optional() }).optional();

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	return withApiRoute(request, { permission: "docker:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: serviceActionSchema }, async ({ session, body }) => {
		const { slug } = await params;
		const { action } = body;
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
			message: reused ? "The service already has a lifecycle task in progress, returning the existing task。" : "QuickService operationalreadyaddedbackgroundtask，you can check progress in the task center。",
		}, { status: 202 });
	});
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	return withApiRoute(request, { permission: "docker:manage", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: "Uninstall failed", bodySchema: uninstallSchema }, async ({ session, body }) => {
		const { slug } = await params;
		const deleteVolumes = body?.deleteVolumes === true;
		const { job, taskId, reused } = await enqueueQuickServiceJob({
			title: `Uninstall quick service：${slug}`,
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
			message: reused ? "The service already has a lifecycle task in progress, returning the existing task。" : "Quick service uninstall has been added as a background task，you can check progress in the task center。",
		}, { status: 202 });
	});
}
