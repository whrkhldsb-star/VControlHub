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
import { validateWebhookUrlSyntax } from "@/lib/security/webhook-url";

export const dynamic = "force-dynamic";

const metrics = [
  "cpu_usage",
  "mem_usage",
  "disk_usage",
  "server_offline",
] as const;
const operators = ["gt", "gte", "lt", "lte", "eq"] as const;
const channels = ["in_app", "email", "webhook"] as const;
const silenceWindowSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, "静默期格式应为 HH:mm-HH:mm，例如 22:00-08:00");

const alertRuleSchemaBase = z.object({
  name: z.string().trim().min(1, "规则名称不能为空").max(100, "规则名称过长"),
  metric: z.enum(metrics),
  operator: z.enum(operators),
  threshold: z.coerce.number().finite().min(0).max(100),
  durationSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
  serverIds: z.array(z.string().trim().min(1)).default([]),
  notifyChannels: z.array(z.enum(channels)).default(["in_app"]),
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
      .startsWith("https://", "Webhook URL 必须使用 https://")
      .refine(
        (value) => validateWebhookUrlSyntax(value).ok,
        "Webhook URL 不允许指向本机或内网地址",
      )
      .optional(),
  ),
  cooldownMinutes: z.coerce.number().int().min(1).max(10_080).optional(),
  silenceWindows: z.array(silenceWindowSchema).max(8).default([]),
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
      message: "启用 Webhook 时必须填写 Webhook URL",
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

function wantsHtml(request: Request) {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

async function parseBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
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
      webhookUrl: form.get("webhookUrl")
        ? String(form.get("webhookUrl"))
        : null,
      cooldownMinutes: form.get("cooldownMinutes")
        ? String(form.get("cooldownMinutes"))
        : undefined,
      silenceWindows: form.getAll("silenceWindows").map(String).map((value) => value.trim()).filter(Boolean),
    };
  }
  return request.json().catch(() => null);
}

function auditRuleDetail(rule: {
  id?: string;
  name?: string;
  metric?: string;
  notifyChannels?: string[];
  webhookUrl?: string | null;
}) {
  return {
    ruleId: rule.id ?? null,
    name: rule.name ?? null,
    metric: rule.metric ?? null,
    notifyChannels: rule.notifyChannels ?? [],
    webhookConfigured: Boolean(rule.webhookUrl),
  };
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "notification:manage" },
    async () => {
      const rules = await listAlertRules();
      return NextResponse.json({ rules });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "notification:manage", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      try {
        const input = alertRuleSchema.parse(await parseBody(request));
        const rule = await createAlertRule(input);
        auditUserAction(
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
      } catch (err) {
        const message = err instanceof Error ? err.message : "创建失败";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    { permission: "notification:manage", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      try {
        const body = await request.json().catch(() => null);
        if (body?.toggleId) {
          const result = await toggleAlertRule(String(body.toggleId));
          auditUserAction(session.userId, "alert_rule.toggle", {
            ruleId: String(body.toggleId),
            enabled: Boolean(result.enabled),
          });
          return NextResponse.json({ rule: result });
        }
        if (body?.testId) {
          const result = await testAlertRule(String(body.testId));
          auditUserAction(session.userId, "alert_rule.test", {
            ruleId: result.rule.id,
            name: result.rule.name,
            channels: result.deliveries.map((delivery) => delivery.channel),
            statuses: result.deliveries.map((delivery) => delivery.status),
          });
          return NextResponse.json(result);
        }
        const input = updateAlertRuleSchema.parse(body);
        const result = await updateAlertRule(input.id, input);
        auditUserAction(
          session.userId,
          "alert_rule.update",
          auditRuleDetail(result),
        );
        return NextResponse.json({ rule: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "更新失败";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    { permission: "notification:manage", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");
        if (!id)
          return NextResponse.json({ error: "缺少规则 ID" }, { status: 400 });
        await deleteAlertRule(id);
        auditUserAction(session.userId, "alert_rule.delete", { ruleId: id });
        return NextResponse.json({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "删除失败";
        return NextResponse.json({ error: message }, { status: 400 });
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
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      try {
        await evaluateAlerts();
        auditUserAction(session.userId, "alert_rule.evaluate", {
          manual: true,
        });
        return NextResponse.json({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "检测失败";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    },
  );
}
