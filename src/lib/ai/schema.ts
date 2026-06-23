import { z } from "zod";

/**
 * AI domain zod schemas (TR-037 R7).
 *
 * Background: 8 AI routes (`/api/ai/*`) used to inline `z.object({...})` either
 * at module scope or inside the route handler. To centralise the boundary (so
 * the audit script can verify coverage), each route now imports the relevant
 * schema from this file. Behaviour is identical to the inline versions: same
 * keys, same validators, same defaults.
 *
 * The schemas are intentionally permissive (e.g. `z.string().min(1)` rather
 * than a strict URL validator for `baseUrl` in `probeModelsSchema`) so the
 * migration does not introduce new validation failures for callers that were
 * already passing under the inline form. Tighten individual fields only if
 * the audit script flags missing constraints and the change is behaviour-
 * preserving for existing tests.
 */

// === Provider schemas ===

// `OPENAI_COMPATIBLE` and `ANTHROPIC` are the two AI provider types that the
// app currently wires up. We keep this enum aligned with the runtime
// `provider.type` column; new types should be added here and in
// `service-crud.ts` together.
export const aiProviderTypeSchema = z.enum([
  "OPENAI_COMPATIBLE",
  "ANTHROPIC",
]);

// POST /api/ai/providers body. `type` is optional because the legacy
// inline form omitted it and tests rely on the default. `models` is the
// legacy comma-separated text input; new code should prefer
// `availableModels` (array).
export const createProviderSchema = z.object({
  name: z.string().min(1, "提供商名称不能为空").max(128, "提供商名称过长"),
  type: aiProviderTypeSchema.optional(),
  apiKey: z.string().min(1, "API Key 不能为空"),
  baseUrl: z.string().trim().max(2048, "基础 URL 过长").optional(),
  models: z.string().trim().max(8192, "模型列表过长").optional(),
  availableModels: z.array(z.string().trim().min(1)).max(256, "模型过多").optional(),
  defaultModel: z.string().trim().min(1).max(128).optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

// PATCH /api/ai/providers/[id] body. All fields optional; empty body is
// allowed (the service layer will treat it as a no-op).
export const updateProviderSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  type: aiProviderTypeSchema.optional(),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().trim().max(2048).optional(),
  models: z.string().trim().max(8192).optional(),
  availableModels: z.array(z.string().trim().min(1)).max(256).optional(),
  defaultModel: z.string().trim().min(1).max(128).optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

// === Conversation schemas ===

// POST /api/ai/conversations body. Provider + model are required; the
// sampling parameters mirror OpenAI's chat completion API.
export const createConversationSchema = z.object({
  title: z.string().min(1).max(200, "标题过长").optional(),
  providerId: z.string().min(1, "缺少提供商"),
  model: z.string().min(1, "缺少模型"),
  systemPrompt: z.string().max(2000, "系统提示过长").optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(128000, "max_tokens 过大").optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  enableVision: z.boolean().optional(),
  hostingEnabled: z.boolean().optional(),
});

// PATCH /api/ai/conversations/[id] body. Same field set as the create
// schema minus `providerId` (provider is fixed at creation time).
// `clearMessages` is a special action flag handled by the route.
export const updateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  systemPrompt: z.string().max(2000).optional(),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(128000).optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  enableVision: z.boolean().optional(),
  hostingEnabled: z.boolean().optional(),
  clearMessages: z.boolean().optional(),
});

// === Model + chat schemas ===

// GET /api/ai/models?providerId=… query. The `providerId` is required by
// the route handler; zod's `.min(1)` enforces that a non-empty value was
// supplied so the route can return a clean 400.
export const aiModelsQuerySchema = z.object({
  providerId: z.string().trim().min(1, "缺少 providerId"),
});

// POST /api/ai/models/probe body. The caller probes a brand-new provider
// before saving it, so `apiKey` is required and `baseUrl`/`defaultModel`
// are optional.
export const probeModelsSchema = z.object({
  apiKey: z.string().min(1, "缺少 API Key"),
  baseUrl: z.string().trim().max(2048, "基础 URL 过长").optional(),
  defaultModel: z.string().trim().min(1).max(128).optional(),
});

// POST /api/ai/chat body. The caller sends either `message` (newer clients)
// or `content` (legacy clients — the route handler reads `body.content`).
// The schema accepts both as the user text. `conversationId` is optional
// at the schema level — the route enforces "must be set" after zod
// validation to keep the public error message stable.
//
// Behaviour-preserving note: the previous inline `chatSchema` required
// `message: z.string().min(1)`, but the real client (ai-client.tsx) only
// sends `content`. That made every chat request 400 out at the zod
// layer. The migrated schema accepts either field; the route's manual
// check (`!body.conversationId || !body.content?.trim()`) is the
// authoritative gate.
export const chatRequestSchema = z
  .object({
    conversationId: z.string().trim().min(1).optional(),
    message: z.string().min(1, "消息内容不能为空").max(64_000, "消息过长").optional(),
    content: z.string().max(64_000, "消息过长").optional(),
    model: z.string().trim().min(1).max(128).optional(),
    providerId: z.string().trim().min(1).max(128).optional(),
    imageUrls: z.array(z.string().trim().url()).max(8).optional(),
    imageBase64: z
      .array(
        z.object({
          mimeType: z.string().trim().min(1).max(64),
          data: z.string().min(1).max(8_000_000, "图片数据过大"),
        }),
      )
      .max(8)
      .optional(),
    fileAttachments: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(255),
          content: z.string().max(256_000, "附件内容过大"),
        }),
      )
      .max(8)
      .optional(),
  })
  .refine(
    (value) =>
      Boolean(value.message?.trim()) || Boolean(value.content?.trim()),
    { message: "消息内容不能为空", path: ["message"] },
  );

// === Hosted action schemas ===

// PATCH /api/ai/hosted-actions/[id] body. `action: "confirm"` records the
// requester's in-page confirmation and creates a CommandRequest; `approve` is
// kept for admin approval of legacy auto-executed hosted actions. `reject`
// requires a non-empty `reason` for the audit log.
export const hostedActionDecisionSchema = z
  .object({
    action: z.enum(["approve", "reject", "confirm"]),
    reason: z.string().trim().max(500, "理由过长").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "reject" && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "拒绝操作必须填写理由",
      });
    }
  });

// === Inferred types (re-exported so route files can `import { type X }`) ===

export type CreateProviderInputWire = z.infer<typeof createProviderSchema>;
export type UpdateProviderInputWire = z.infer<typeof updateProviderSchema>;
export type CreateConversationInputWire = z.infer<
  typeof createConversationSchema
>;
export type UpdateConversationInputWire = z.infer<
  typeof updateConversationSchema
>;
export type AiModelsQuery = z.infer<typeof aiModelsQuerySchema>;
export type ProbeModelsBody = z.infer<typeof probeModelsSchema>;
export type ChatRequestBody = z.infer<typeof chatRequestSchema>;
export type HostedActionDecisionBody = z.infer<
  typeof hostedActionDecisionSchema
>;
export type AiProviderType = z.infer<typeof aiProviderTypeSchema>;
