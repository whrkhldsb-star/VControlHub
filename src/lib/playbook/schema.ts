/**
 * TR-023 M04: Playbook zod schemas — input validation for the API routes.
 *
 * Why zod at the API boundary?
 * - The Playbook model stores `triggerConfig` and `steps` as JSON, so we
 *   need a single source of truth for "what does a valid playbook look
 *   like" that the form, the API, and the executor all consume.
 * - The trigger config is a discriminated union (cron vs metric); the
 *   editor must surface one form per type. zod's `discriminatedUnion`
 *   gives us type narrowing without a manual switch.
 */

import { z } from "zod";

import {
  METRICS,
  OPERATORS,
  STEP_TYPES,
  TRIGGER_TYPES,
} from "./types";

const stepNameSchema = z
  .string()
  .trim()
  .min(1, "Step name is required")
  .max(80, "Step name must be at most 80 characters");

const runCommandConfigSchema = z.object({
  command: z.string().trim().min(1, "Command is required").max(10_000),
  serverIds: z.array(z.string().min(1)).max(64, "Single step supports at most 64 VPS"),
  variables: z.record(z.string(), z.string()).optional(),
});

const sendNotificationConfigSchema = z.object({
  recipientUserId: z.string().trim().min(1, "Recipient is required"),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().trim().min(1, "Content is required").max(2_000),
});

const callWebhookConfigSchema = z.object({
  url: z
    .string()
    .trim()
    .url("Webhook URL 无效")
    .max(2_000)
    .refine(
      (raw) => raw.startsWith("https://") || raw.startsWith("http://"),
      "Webhook URL 必须以 http(s):// 开头",
    ),
  method: z.enum(["GET", "POST", "PUT"]),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().max(20_000).optional(),
});

const stepSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: stepNameSchema,
    type: z.enum(STEP_TYPES),
    config: z.unknown(), // narrowed by the union below
    retry: z.number().int().min(0).max(5).default(0),
    timeoutSec: z.number().int().min(1).max(3_600).default(60),
  })
  .and(
    z.union([
      z.object({
        type: z.literal("run_command"),
        config: runCommandConfigSchema,
      }),
      z.object({
        type: z.literal("send_notification"),
        config: sendNotificationConfigSchema,
      }),
      z.object({
        type: z.literal("call_webhook"),
        config: callWebhookConfigSchema,
      }),
    ]),
  );

const cronTriggerConfigSchema = z.object({
  expression: z
    .string()
    .trim()
    .min(1, "Cron expression is required")
    .max(120)
    .refine(
      // 5-field cron (minute hour day-of-month month day-of-week)
      (expr) => /^\S+\s+\S+\s+\S+\s+\S+\s+\S+(\s+\S+)?$/.test(expr),
      "Cron 表达式需为 5 字段（分 时 日 月 周）",
    ),
});

const metricTriggerConfigSchema = z.object({
  metric: z.enum(METRICS),
  operator: z.enum(OPERATORS),
  threshold: z.number().finite(),
});

const triggerConfigSchema = z.union([
  cronTriggerConfigSchema,
  metricTriggerConfigSchema,
]);

const baseCreatePlaybookObject = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional().nullable(),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: triggerConfigSchema,
  steps: z
    .array(stepSchema)
    .min(1, "At least 1 step is required")
    .max(32, "At most 32 steps are allowed"),
  chainRetry: z.number().int().min(0).max(5).default(0),
  enabled: z.boolean().default(true),
});

export const createPlaybookSchema = baseCreatePlaybookObject.superRefine(
  (value, ctx) => {
    if (value.triggerType === "cron" && !("expression" in value.triggerConfig)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["triggerConfig"],
        message: "Cron 触发器需要 expression 字段",
      });
    }
    if (value.triggerType === "metric" && !("metric" in value.triggerConfig)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["triggerConfig"],
        message: "指标触发器需要 metric / operator / threshold 字段",
      });
    }
  },
);

/**
 * Update schema — every field optional except the `id` we route to.
 *
 * zod 4 forbids `.partial()` on object schemas carrying refinements, so we
 * build the partial shape explicitly instead of chaining `.partial()`. The
 * field set mirrors `baseCreatePlaybookObject`.
 */
export const updatePlaybookSchema = z
  .object({
    id: z.string().min(1),
    name: baseCreatePlaybookObject.shape.name.optional(),
    description: baseCreatePlaybookObject.shape.description,
    triggerType: baseCreatePlaybookObject.shape.triggerType.optional(),
    triggerConfig: baseCreatePlaybookObject.shape.triggerConfig.optional(),
    steps: baseCreatePlaybookObject.shape.steps.optional(),
    chainRetry: baseCreatePlaybookObject.shape.chainRetry.optional(),
    enabled: baseCreatePlaybookObject.shape.enabled.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.triggerType !== undefined && value.triggerConfig !== undefined) {
      if (
        value.triggerType === "cron" &&
        !("expression" in value.triggerConfig)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["triggerConfig"],
          message: "Cron 触发器需要 expression 字段",
        });
      }
      if (
        value.triggerType === "metric" &&
        !("metric" in value.triggerConfig)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["triggerConfig"],
          message: "指标触发器需要 metric / operator / threshold 字段",
        });
      }
    }
  });

export type CreatePlaybookInput = z.infer<typeof createPlaybookSchema>;
export type UpdatePlaybookInput = z.infer<typeof updatePlaybookSchema>;

export const idQuerySchema = z.object({
  id: z.string().trim().min(1),
});
