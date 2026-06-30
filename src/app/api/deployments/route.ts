import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import {
  createDeploymentRunFromTemplate,
  listDeploymentRuns,
  listDeploymentTemplates,
} from "@/lib/deployment/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { AppError, isAppError, ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

const createDeploymentSchema = z.object({
  templateId: z.string().trim().min(1, "templateId 必填"),
  serverIds: z
    .array(z.string().trim().min(1, "目标 VPS 不能为空"))
    .min(1, "至少选择 1 台目标 VPS"),
  variables: z.record(z.string(), z.string()).default({}),
  reason: z.string().trim().max(500, "原因最多 500 个字符").optional(),
});

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "deploy:read", errorMessage: "获取部署列表失败" },
    async () => {
      const [deployments, templates] = await Promise.all([
        listDeploymentRuns(),
        listDeploymentTemplates(),
      ]);
      return NextResponse.json({ deployments, templates });
    },
  );
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
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("variables.") || typeof value !== "string") continue;
    const name = key.slice("variables.".length).trim();
    if (name) variables[name] = value;
  }
  return {
    templateId: formData.get("templateId"),
    serverIds: formData.getAll("serverIds"),
    variables,
    reason: formData.get("reason") || undefined,
  };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const isFormSubmission = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  const options = {
    permission: "deploy:run" as const,
    rateLimit: GENERAL_WRITE_LIMIT,
    errorMessage: "操作失败",
    ...(isFormSubmission ? {} : { bodySchema: createDeploymentSchema }),
  };
  return withApiRoute(
    request,
    options,
    async ({ session, body }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );
      try {
        const parsed = isFormSubmission ? createDeploymentSchema.safeParse(await readRequestBody(request)) : { success: true as const, data: body };
        if (!parsed.success) {
          const message = parsed.error.issues[0]?.message ?? "部署参数无效";
          if (wantsHtmlResponse(request))
            return redirectToDeploymentsWithError(request, message);
          throw new ValidationError(message);
        }
        const deployment = await createDeploymentRunFromTemplate({
          ...parsed.data,
          requesterId: session.userId,
        });
        auditUserAction(session.userId, "deployment.create", {
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
        // Re-throw typed AppErrors (e.g. ValidationError) so `withApiRoute`'s
        // `apiCatch` envelope preserves their `code` / `status` / `details`.
        // Only opaque errors (plain Error / unknown) get wrapped into a
        // generic INTERNAL_ERROR 500. TR-034 R2.
        if (isAppError(error)) throw error;
        const message = error instanceof Error ? error.message : "操作失败";
        if (wantsHtmlResponse(request))
          return redirectToDeploymentsWithError(request, message);
        throw new AppError({ code: "INTERNAL_ERROR", message: message, status: 500 });
      }
    },
  );
}
