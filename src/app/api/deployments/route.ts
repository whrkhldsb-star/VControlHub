import { apiCopy } from "@/lib/i18n/api-copy";
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
import { getErrorMessage } from "@/lib/http/error-message";
import {
  MAX_NON_FILE_FORM_BYTES,
  requestContentLengthExceeds,
  requestContentLengthMissing,
} from "@/lib/http/request-body";
import { t } from "@/lib/i18n/service-translations";
export const dynamic = "force-dynamic";

const createDeploymentSchema = z.object({
  templateId: z.string().trim().min(1, "templateId is required"),
  serverIds: z
    .array(z.string().trim().min(1, "Target VPS is required"))
    .min(1, "At least 1 target VPS must be selected"),
  variables: z.record(z.string(), z.string()).default({}),
  reason: z.string().trim().max(500, "ReasonAt most 500 characters").optional(),
	idempotencyKey: z.string().trim().min(1).max(300).optional(),
});

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "deploy:read", errorMessage: apiCopy("apiCopy.failed.to.fetch.deployment.list.fa66fa85") },
    async ({ session }) => {
      const [deployments, templates] = await Promise.all([
        listDeploymentRuns(session),
        listDeploymentTemplates(session),
      ]);
      return NextResponse.json({ deployments, templates });
    },
  );
}

function wantsHtmlResponse(request: Request) {
  return (request.headers.get("accept") || "").includes("text/html");
}

/** 303 back to /deployments; optional flash via ?error= or ?success=1. */
function redirectToDeployments(
  request: Request,
  options?: { error?: string; success?: boolean },
) {
  const url = new URL("/deployments", request.url);
  if (options?.error) url.searchParams.set("error", options.error);
  if (options?.success) url.searchParams.set("success", "1");
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
      // A malformed variablesJson must not fall back to an empty set: the
      // deployment would run its template with unset variables — the worst
      // failure mode for a deploy pipeline (commands execute with missing
      // values and per-field overrides would silently mix in). Fail loudly.
      throw new ValidationError(t("backend.deployment.invalidVariablesJson"));
    }
    if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
      throw new ValidationError(t("backend.deployment.invalidVariablesJson"));
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
  if (isFormSubmission && requestContentLengthExceeds(request, MAX_NON_FILE_FORM_BYTES)) {
    return NextResponse.json({ error: t("backend.request.bodyTooLarge") }, { status: 413 });
  }
  // Chunked form posts with no declared length would buffer unbounded bytes in
  // request.formData() before any check — mirror the upload routes' 411.
  if (isFormSubmission && requestContentLengthMissing(request)) {
    return NextResponse.json({ error: t("backend.request.bodyTooLarge") }, { status: 411 });
  }
  const options = {
    permission: "deploy:run" as const,
    rateLimit: GENERAL_WRITE_LIMIT,
    errorMessage: apiCopy("apiCopy.operation.failed.4e1af7c7"),
    ...(isFormSubmission ? {} : { bodySchema: createDeploymentSchema }),
  };
  return withApiRoute(
    request,
    options,
    async ({ session, body }) => {
      try {
        const parsed = isFormSubmission ? createDeploymentSchema.safeParse(await readRequestBody(request)) : { success: true as const, data: body };
        if (!parsed.success) {
          const message = parsed.error.issues[0]?.message ?? "Invalid deployment parameters";
          if (wantsHtmlResponse(request))
            return redirectToDeployments(request, { error: message });
          throw new ValidationError(message);
        }
				const idempotencyKey = request.headers.get("idempotency-key")?.trim() || parsed.data.idempotencyKey;
				const deployment = await createDeploymentRunFromTemplate({
					...parsed.data,
					...(idempotencyKey ? { idempotencyKey } : {}),
					requesterId: session.userId,
				}, session);
        await auditUserAction(session.userId, "deployment.create", {
          deploymentId: deployment.id,
          templateId: parsed.data.templateId,
          serverIds: parsed.data.serverIds,
          reason: parsed.data.reason ?? null,
        }, undefined, session.currentTeamId);
        if (wantsHtmlResponse(request)) {
          return redirectToDeployments(request, { success: true });
        }
        return NextResponse.json({ deployment }, { status: 201 });
      } catch (error) {
        // Re-throw typed AppErrors (e.g. ValidationError) so `withApiRoute`'s
        // `apiCatch` envelope preserves their `code` / `status` / `details`.
        // Only opaque errors (plain Error / unknown) get wrapped into a
        // generic INTERNAL_ERROR 500. TR-034 R2.
        if (isAppError(error)) throw error;
        const message = getErrorMessage(error, "Operation failed");
        if (wantsHtmlResponse(request))
          return redirectToDeployments(request, { error: message });
        throw new AppError({ code: "INTERNAL_ERROR", message: message, status: 500 });
      }
    },
  );
}
