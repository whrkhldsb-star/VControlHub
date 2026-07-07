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
  templateId: z.string().trim().min(1, "templateId is required"),
  serverIds: z
    .array(z.string().trim().min(1, "Target VPS is required"))
    .min(1, "At least 1 target VPS must be selected"),
  variables: z.record(z.string(), z.string()).default({}),
  reason: z.string().trim().max(500, "ReasonAt most 500 characters").optional(),
});

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "deploy:read", errorMessage: "Failed to fetch deployment list" },
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
      // Invalid JSON in form data — start with empty variables and let per-field entries override.
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
    errorMessage: "OperationFailed",
    ...(isFormSubmission ? {} : { bodySchema: createDeploymentSchema }),
  };
  return withApiRoute(
    request,
    options,
    async ({ session, body }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
          { status: 401 },
        );
      try {
        const parsed = isFormSubmission ? createDeploymentSchema.safeParse(await readRequestBody(request)) : { success: true as const, data: body };
        if (!parsed.success) {
          const message = parsed.error.issues[0]?.message ?? "Invalid deployment parameters";
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
        const message = error instanceof Error ? error.message : "OperationFailed";
        if (wantsHtmlResponse(request))
          return redirectToDeploymentsWithError(request, message);
        throw new AppError({ code: "INTERNAL_ERROR", message: message, status: 500 });
      }
    },
  );
}
