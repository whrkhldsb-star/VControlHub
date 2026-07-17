import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  testAlertRule,
  toggleAlertRule,
} from "@/lib/alert/service";
import { auditUserAction } from "@/lib/audit/service";
import { evaluateAlerts } from "@/lib/health/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { idQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import { validateWebhookUrlSyntax } from "@/lib/security/webhook-url";

import { AuthError, ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

const metrics = [
  "cpu_usage",
  "mem_usage",
  "disk_usage",
  "server_offline",
  "network_in",
  "network_out",
  "load_avg",
  "swap_usage",
] as const;
const operators = ["gt", "gte", "lt", "lte", "eq"] as const;
const channels = ["in_app", "email", "telegram", "webhook"] as const;
const silenceWindowSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, "Silence period format should be HH:mm-HH:mm, e.g. 22:00-08:00");

const alertRuleSchemaBase = z.object({
  name: z.string().trim().min(1, "RuleNameis required").max(100, "RuleNameToo long"),
  metric: z.enum(metrics),
  operator: z.enum(operators),
  threshold: z.coerce.number().finite().min(0).max(100000),
  durationSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  serverIds: z.array(z.string().trim().min(1)).default([]),
  notifyChannels: z.array(z.enum(channels)).default(["in_app"]),
  playbookIds: z.array(z.string().trim().min(1)).default([]),
  webhookUrl: z.preprocess(
    (value) => {
      if (typeof value !== "string" || !value.trim()) return undefined;
      const result = validateWebhookUrlSyntax(value.trim());
      return result.ok ? result.url : value;
    },
    z
      .string()
      .trim()
      .url()
      .startsWith("https://", "Webhook URL Mustusing https://")
      .refine(
        (value) => validateWebhookUrlSyntax(value).ok,
        "Webhook URL is not allowed to point to localhost or internal network address",
      )
      .optional(),
  ),
  cooldownMinutes: z.coerce.number().int().min(1).max(10_080).optional(),
  silenceWindows: z.array(silenceWindowSchema).max(8).default([]),
  escalationMinutes: z.coerce.number().int().min(1).max(10_080).optional(),
  onCallUserIds: z.array(z.string().trim().min(1)).max(50).default([]),
  enabled: z.boolean().optional(),
});

function requireWebhookUrlWhenEnabled(
  value: { notifyChannels?: readonly string[]; webhookUrl?: string },
  ctx: z.RefinementCtx,
) {
  if (value.notifyChannels?.includes("webhook") && !value.webhookUrl) {
    ctx.addIssue({
      code: "custom",
      path: ["webhookUrl"],
      message: "Webhook URL is required when Webhook is enabled",
    });
  }
}

const alertRuleSchema = alertRuleSchemaBase.superRefine(
  requireWebhookUrlWhenEnabled,
);

const updateAlertRuleSchema = alertRuleSchemaBase
  .partial()
  .extend({ id: z.string().trim().min(1) })
  .superRefine(requireWebhookUrlWhenEnabled);

/* ── TR-037 P2: PATCH union schema (toggle / test / update) ─────── */
const toggleAlertRuleSchema = z.object({
  toggleId: z.string().trim().min(1),
});
const testAlertRuleSchema = z.object({
  testId: z.string().trim().min(1),
});
const patchAlertRuleSchema = z.union([
  toggleAlertRuleSchema,
  testAlertRuleSchema,
  updateAlertRuleSchema,
]);

function wantsHtml(request: Request) {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

async function parseBody(request: Request) {
  const form = await request.formData();
  return {
    name: String(form.get("name") ?? ""),
    metric: String(form.get("metric") ?? ""),
    operator: String(form.get("operator") ?? ""),
    threshold: String(form.get("threshold") ?? ""),
    durationSeconds: form.get("durationSeconds")
      ? String(form.get("durationSeconds"))
      : undefined,
    serverIds: form.getAll("serverIds").map(String).filter(Boolean),
    notifyChannels: form.getAll("notifyChannels").map(String).filter(Boolean),
    playbookIds: form.getAll("playbookIds").map(String).filter(Boolean),
    webhookUrl: form.get("webhookUrl")
      ? String(form.get("webhookUrl"))
      : null,
    cooldownMinutes: form.get("cooldownMinutes")
      ? String(form.get("cooldownMinutes"))
      : undefined,
    silenceWindows: form.getAll("silenceWindows").map(String).map((value) => value.trim()).filter(Boolean),
    escalationMinutes: form.get("escalationMinutes")
      ? String(form.get("escalationMinutes"))
      : undefined,
    onCallUserIds: form.getAll("onCallUserIds").map(String).filter(Boolean),
  };
}

function auditRuleDetail(rule: {
  id?: string;
  name?: string;
  metric?: string;
  notifyChannels?: string[];
  playbookIds?: string[];
  webhookUrl?: string | null;
}) {
  return {
    ruleId: rule.id ?? null,
    name: rule.name ?? null,
    metric: rule.metric ?? null,
    notifyChannels: rule.notifyChannels ?? [],
    playbookIds: rule.playbookIds ?? [],
    webhookConfigured: Boolean(rule.webhookUrl),
  };
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "notification:manage" },
    async ({ session }) => {
      const rules = await listAlertRules(session);
      return NextResponse.json({ rules });
    },
  );
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isFormSubmission =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");
  const options = {
    permission: "notification:manage" as const,
    rateLimit: GENERAL_WRITE_LIMIT,
    errorStatus: 400,
    errorMessage: "Failed to create",
    ...(isFormSubmission ? {} : { bodySchema: alertRuleSchema }),
  };
  return withApiRoute(
    request,
    options,
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      const input = isFormSubmission
        ? alertRuleSchema.parse(await parseBody(request))
        : body;
      const rule = await createAlertRule(input, session);
      await auditUserAction(
        session.userId,
        "alert_rule.create",
        auditRuleDetail(rule),
      );
      if (wantsHtml(request)) {
        return NextResponse.redirect(new URL("/alert-rules", request.url), {
          status: 303,
        });
      }
      return NextResponse.json({ rule }, { status: 201 });
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "notification:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorStatus: 400,
      errorMessage: "Failed to update",
      bodySchema: patchAlertRuleSchema,
    },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      if ("toggleId" in body) {
        const result = await toggleAlertRule(body.toggleId, session);
        await auditUserAction(session.userId, "alert_rule.toggle", {
          ruleId: body.toggleId,
          enabled: Boolean(result.enabled),
        });
        return NextResponse.json({ rule: result });
      }
      if ("testId" in body) {
        const result = await testAlertRule(body.testId, session);
        await auditUserAction(session.userId, "alert_rule.test", {
          ruleId: result.rule.id,
          name: result.rule.name,
          channels: result.deliveries.map((delivery) => delivery.channel),
          statuses: result.deliveries.map((delivery) => delivery.status),
        });
        return NextResponse.json(result);
      }
      const result = await updateAlertRule(body.id, body, session);
      await auditUserAction(
        session.userId,
        "alert_rule.update",
        auditRuleDetail(result),
      );
      return NextResponse.json({ rule: result });
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    { permission: "notification:manage", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      try {
        const { id: alertRuleId } = parseSearchParams(request, idQuerySchema);
        if (!alertRuleId)
          throw new ValidationError("Missing rule ID");
        await deleteAlertRule(alertRuleId, session);
        await auditUserAction(session.userId, "alert_rule.delete", { ruleId: alertRuleId });
        return NextResponse.json({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete";
        throw new ValidationError(message);
      }
    },
  );
}

export async function PUT(request: Request) {
  return withApiRoute(
    request,
    { permission: "notification:manage", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      try {
        await evaluateAlerts();
        await auditUserAction(session.userId, "alert_rule.evaluate", {
          manual: true,
        });
        return NextResponse.json({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Detection failed";
        throw new ValidationError(message);
      }
    },
  );
}
