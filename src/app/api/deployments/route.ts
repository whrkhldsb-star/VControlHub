import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { createDeploymentRunFromTemplate, listDeploymentRuns, listDeploymentTemplates } from "@/lib/deployment/service";
import { enforceApiGuard } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const createDeploymentSchema = z.object({
	templateId: z.string().trim().min(1, "templateId 必填"),
	serverIds: z.array(z.string().trim().min(1, "目标 VPS 不能为空")).min(1, "至少选择 1 台目标 VPS"),
	variables: z.record(z.string(), z.string()).default({}),
	reason: z.string().trim().max(500, "原因最多 500 个字符").optional(),
});

export async function GET() {
	const guard = await enforceApiGuard({ request: new Request("http://local/api/deployments"), permission: "deploy:read" });
	if (guard instanceof Response) return guard;
	const [deployments, templates] = await Promise.all([listDeploymentRuns(), listDeploymentTemplates()]);
	return NextResponse.json({ deployments, templates });
}

function wantsHtmlResponse(request: Request) {
	return (request.headers.get("accept") || "").includes("text/html");
}

function redirectToDeploymentsWithError(request: Request, message?: string) {
	const url = new URL("/deployments", request.url);
	if (message) url.searchParams.set("error", message);
	return NextResponse.redirect(url, { status: 303 });
}

async function readRequestBody(request: Request) {
	const contentType = request.headers.get("content-type") || "";
	if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
		const formData = await request.formData();
		const variablesJson = formData.get("variablesJson");
		let variables: Record<string, string> = {};
		if (typeof variablesJson === "string" && variablesJson.trim()) {
			try {
				variables = JSON.parse(variablesJson) as Record<string, string>;
			} catch {
				variables = {};
			}
		}
		return {
			templateId: formData.get("templateId"),
			serverIds: formData.getAll("serverIds"),
			variables,
			reason: formData.get("reason") || undefined,
		};
	}
	return request.json().catch(() => ({}));
}

export async function POST(request: Request) {
	const guard = await enforceApiGuard({ request, permission: "deploy:run", rateLimit: GENERAL_WRITE_LIMIT });
	if (guard instanceof Response) return guard;
	if (!guard) return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
	try {
		const body = await readRequestBody(request);
		const parsed = createDeploymentSchema.safeParse(body);
		if (!parsed.success) {
			const message = parsed.error.issues[0]?.message ?? "部署参数无效";
			if (wantsHtmlResponse(request)) return redirectToDeploymentsWithError(request, message);
			return NextResponse.json({ error: message }, { status: 400 });
		}
		const deployment = await createDeploymentRunFromTemplate({ ...parsed.data, requesterId: guard.userId });
		auditUserAction(guard.userId, "deployment.create", {
			deploymentId: deployment.id,
			templateId: parsed.data.templateId,
			serverIds: parsed.data.serverIds,
			reason: parsed.data.reason ?? null,
		});
		if (wantsHtmlResponse(request)) {
			return redirectToDeploymentsWithError(request);
		}
		return NextResponse.json({ deployment }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : "操作失败";
		if (wantsHtmlResponse(request)) return redirectToDeploymentsWithError(request, message);
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
