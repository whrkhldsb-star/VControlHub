import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { z } from "zod";

import { createDeploymentRunFromTemplate, listDeploymentRuns, listDeploymentTemplates } from "@/lib/deployment/service";
import { withRateLimit, rateLimitResponse, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

const createDeploymentSchema = z.object({
  templateId: z.string().trim().min(1, "templateId 必填"),
  serverIds: z.array(z.string().trim().min(1, "目标 VPS 不能为空")).min(1, "至少选择 1 台目标 VPS"),
  variables: z.record(z.string(), z.string()).default({}),
  reason: z.string().trim().max(500, "原因最多 500 个字符").optional(),
});

export async function GET() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "deploy:read")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  const [deployments, templates] = await Promise.all([listDeploymentRuns(), listDeploymentTemplates()]);
  return NextResponse.json({ deployments, templates });
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
  const rl = withRateLimit(request, GENERAL_WRITE_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  try {
    const session = await requireSession();
    if (!sessionHasPermission(session, "deploy:run")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
    const body = await readRequestBody(request);
    const parsed = createDeploymentSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "部署参数无效" }, { status: 400 });
    const deployment = await createDeploymentRunFromTemplate({ ...parsed.data, requesterId: session.userId });
    if ((request.headers.get("accept") || "").includes("text/html")) {
      return NextResponse.redirect(new URL("/deployments", request.url), { status: 303 });
    }
    return NextResponse.json({ deployment }, { status: 201 });
  } catch (error) {
  	const message = error instanceof Error ? error.message : "操作失败";
  	return NextResponse.json({ error: message }, { status: 500 });
  }
}
