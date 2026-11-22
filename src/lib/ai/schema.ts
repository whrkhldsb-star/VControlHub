import { isLocalOllamaEndpoint, requiresExplicitDefaultModel } from "./provider-endpoint";
import { z } from "zod";
import {
  aiOpsModeSchema,
  aiOpsStatusSchema,
  aiOpsTriggerSchema,
} from "./ops/schema";

export { approveRecommendationSchema } from "./ops/schema";

export const knowledgeDocumentPageSchema = z.object({
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().max(2_147_483_647)).optional(),
});

export const aiOpsLogsQuerySchema = z.object({
  mode: aiOpsModeSchema.optional(),
  status: aiOpsStatusSchema.optional(),
  triggerType: aiOpsTriggerSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

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

// Keep aligned with Prisma `AiProviderType` and runtime branches
// (e.g. GOOGLE chat path in service-runtime).
export const aiProviderTypeSchema = z.enum([
  "OPENAI",
  "OPENAI_COMPATIBLE",
  "ANTHROPIC",
  "GOOGLE",
  "CUSTOM",
]);

// POST /api/ai/providers body. `type` is optional because the legacy
// inline form omitted it and tests rely on the default. `models` is the
// legacy comma-separated text input; new code should prefer
// `availableModels` (array).
// A provider's model list. The server itself writes up to 10,000 discovered ids into availableModels (an aggregating
// gateway such as OpenRouter lists hundreds), so the limits here match that: at 256 entries / 8,192 characters the
// provider could not be created, nor edited afterwards (rotating its key or changing its URL), without deleting it
// and, with it, every conversation.
// A full list of 10,000 model IDs fits even when every JSON character needs escaping.
export const PROVIDER_REQUEST_MAX_BODY_BYTES = 16 * 1024 * 1024;
export const MAX_PROVIDER_MODELS = 10_000;
const MAX_PROVIDER_MODELS_TEXT = 400_000;
export const providerModelIdSchema = z.string().trim().min(1).max(256);
export const providerModelListSchema = z.array(providerModelIdSchema).max(MAX_PROVIDER_MODELS, "Too many models")
  .transform((models) => [...new Set(models)]);
/** Read valid IDs from pre-upgrade model lists without losing the rest of the list. */
export function usableProviderModelIds(values: unknown[]) {
  const ids = new Set<string>();
  for (const value of values) {
    const model = providerModelIdSchema.safeParse(value);
    if (model.success) ids.add(model.data);
    if (ids.size === MAX_PROVIDER_MODELS) break;
  }
  return [...ids];
}

const csvModels = z.string().trim().max(MAX_PROVIDER_MODELS_TEXT, "Model list is too long")
  .transform((csv) => csv.split(",").map((id) => id.trim()).filter(Boolean)).pipe(providerModelListSchema);

function mergeModelLists<T extends { models?: string[]; availableModels?: string[] }>({ models, availableModels, ...rest }: T) {
  const ids = availableModels ?? models;
  return { ...rest, ...(ids !== undefined && { availableModels: ids }) };
}

export const createProviderSchema = z.object({
  name: z.string().trim().min(1, "Provider name is required").max(128, "Provider name is too long"),
  type: aiProviderTypeSchema.optional(),
  apiKey: z.string().trim().default(""),
  baseUrl: z.string().trim().max(2048, "Base URL is too long").optional(),
  models: csvModels.optional(),
  availableModels: providerModelListSchema.optional(),
  defaultModel: providerModelIdSchema.optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Boolean(value.apiKey) || isLocalOllamaEndpoint(value.baseUrl, value.type), {
  path: ["apiKey"], message: "API Key is required",
}).refine((value) => !requiresExplicitDefaultModel(value.type) || Boolean(value.defaultModel), {
  path: ["defaultModel"], message: "Missing model",
}).transform(mergeModelLists);

// PATCH /api/ai/providers/[id] body. All fields optional; empty body is
// allowed (the service layer will treat it as a no-op).
export const updateProviderSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  type: aiProviderTypeSchema.optional(),
  apiKey: z.string().trim().min(1).optional(),
  expectedEndpoint: z.object({ type: aiProviderTypeSchema, baseUrl: z.string().max(2048) }).optional(),
  baseUrl: z.string().trim().max(2048).optional(),
  models: csvModels.optional(),
  availableModels: providerModelListSchema.optional(),
  defaultModel: providerModelIdSchema.optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
}).transform(mergeModelLists);

// === Conversation schemas ===

// POST /api/ai/conversations body. Provider + model are required; the
// sampling parameters mirror OpenAI's chat completion API.
export const createConversationSchema = z.object({
  title: z.string().min(1).max(200, "Title is too long").optional(),
  providerId: z.string().min(1, "Missing provider"),
  model: z.string().min(1, "Missing model"),
  systemPrompt: z.string().max(2000, "System prompt is too long").optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(128000, "max_tokens is too large").optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  enableVision: z.boolean().optional(),
  hostingEnabled: z.boolean().optional(),
  automationMode: z.enum(["ASSISTED", "PLAN_ONLY"]).optional(),
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
  automationMode: z.enum(["ASSISTED", "PLAN_ONLY"]).optional(),
  clearMessages: z.boolean().optional(),
});

// === Model + chat schemas ===

// GET /api/ai/models?providerId=… query. The `providerId` is required by
// the route handler; zod's `.min(1)` enforces that a non-empty value was
// supplied so the route can return a clean 400.
export const aiModelsQuerySchema = z.object({
  providerId: z.string().trim().min(1, "Missing providerId"),
});

// POST /api/ai/models/probe body. The caller probes a brand-new provider
// before saving it, so `apiKey` is required and `baseUrl`/`defaultModel`
// are optional.
export const probeModelsSchema = z.object({
  // The provider panel sends it; dropping it made every probe use Bearer auth.
  type: aiProviderTypeSchema.optional(),
  apiKey: z.string().trim().default(""),
  baseUrl: z.string().trim().max(2048, "Base URL is too long").optional(),
  defaultModel: providerModelIdSchema.optional(),
}).refine((value) => Boolean(value.apiKey) || isLocalOllamaEndpoint(value.baseUrl, value.type), {
  path: ["apiKey"], message: "Missing API Key",
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
/**
 * Images and PDFs travel in the chat request as base64 (up to 8,000,000
 * characters each, below). The default 1 MiB refused every real screenshot.
 * Must stay within PROXY_CLIENT_MAX_BODY_BYTES: Next passes a route behind the
 * proxy no more than that of a body, and the rest is dropped without an error.
 */
export const CHAT_REQUEST_MAX_BODY_BYTES = 32 * 1024 * 1024;

export const chatRequestSchema = z
  .object({
    conversationId: z.string().trim().min(1).optional(),
    message: z.string().min(1, "Message content is required").max(64_000, "Message is too long").optional(),
    content: z.string().max(64_000, "Message is too long").optional(),
    model: providerModelIdSchema.optional(),
    providerId: z.string().trim().min(1).max(128).optional(),
    imageUrls: z.array(z.string().trim().max(2048).pipe(z.url({ protocol: /^https?$/ }))).max(8).optional(),
    imageBase64: z
      .array(
        z.object({
          mimeType: z.string().trim().min(1).max(64),
          data: z.string().min(1).max(8_000_000, "Image data is too large"),
        }),
      )
      .max(8)
      .optional(),
    fileAttachments: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(255),
          content: z.string().max(256_000, "Attachment content is too large"),
        }),
      )
      .max(8)
      .optional(),
  })
  .refine(
    (value) =>
      Boolean(value.message?.trim()) || Boolean(value.content?.trim()),
    { message: "Message content cannot be empty", path: ["message"] },
  );

// === Hosted action schemas ===

// PATCH /api/ai/hosted-actions/[id] body. `action: "confirm"` records the
// requester's in-page confirmation and creates a CommandRequest; `approve` is
// kept for admin approval of legacy auto-executed hosted actions. `reject`
// requires a non-empty `reason` for the audit log.
export const hostedActionDecisionSchema = z
  .object({
    action: z.enum(["approve", "reject", "confirm"]),
    reason: z.string().trim().max(500, "Reason is too long").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "reject" && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A reason is required for reject actions",
      });
    }
  });

// === Inferred types (re-exported so route files can `import { type X }`) ===

export type UpdateProviderInputWire = z.infer<typeof updateProviderSchema>;
export type ChatRequestBody = z.infer<typeof chatRequestSchema>;
export type AiProviderType = z.infer<typeof aiProviderTypeSchema>;
