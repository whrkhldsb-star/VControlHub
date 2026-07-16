import { NextResponse } from "next/server";
import { z } from "zod";
import { auditUserAction } from "@/lib/audit/service";
import { enqueueQuickServiceJob } from "@/lib/quick-service/job-worker";
import { HUB_HOST_INSTANCE_KEY } from "@/lib/quick-service/docker-cli";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const serviceActionSchema = z.object({
	action: z.enum(["start", "stop", "sync", "update"]),
	serverId: z.string().min(1).optional().nullable(),
});
const uninstallSchema = z.object({
	deleteVolumes: z.boolean().optional(),
	serverId: z.string().min(1).optional().nullable(),
}).optional();

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	return withApiRoute(request, { permission: "docker:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: serviceActionSchema }, async ({ session, body }) => {
		const { slug } = await params;
		const { action } = body;
		const serverId = body.serverId?.trim() || "";
		const instanceKey = serverId || HUB_HOST_INSTANCE_KEY;
		const { job, taskId, reused } = await enqueueQuickServiceJob({
			title: `QuickService ${action}: ${slug} @ ${instanceKey}`,
			createdBy: session?.userId ?? null,
			payload: { action, slug, instanceKey, serverId: serverId || null },
		});
		return NextResponse.json({
			success: true,
			queued: true,
			reused,
			jobId: job.id,
			taskId,
			status: job.status,
			message: reused ? "The service already has a lifecycle task in progress, returning the existing task." : "Quick service operation already added as a background task, you can check progress in the task center.",
		}, { status: 202 });
	});
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	return withApiRoute(request, { permission: "docker:manage", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: "Uninstall failed", bodySchema: uninstallSchema }, async ({ session, body }) => {
		const { slug } = await params;
		const deleteVolumes = body?.deleteVolumes === true;
		const serverId = body?.serverId?.trim() || "";
		const instanceKey = serverId || HUB_HOST_INSTANCE_KEY;
		const { job, taskId, reused } = await enqueueQuickServiceJob({
			title: `Uninstall quick service: ${slug} @ ${instanceKey}`,
			createdBy: session?.userId ?? null,
			payload: { action: "uninstall", slug, deleteVolumes, instanceKey, serverId: serverId || null },
		});
		await auditUserAction(session!.userId, "quick_service.uninstall", { slug, instanceKey, serverId: serverId || null });
		return NextResponse.json({
			success: true,
			queued: true,
			reused,
			jobId: job.id,
			taskId,
			status: job.status,
			deleteVolumes,
			message: reused ? "The service already has a lifecycle task in progress, returning the existing task." : "Quick service uninstall has been added as a background task, you can check progress in the task center.",
		}, { status: 202 });
	});
}
