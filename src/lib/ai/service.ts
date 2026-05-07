import { prisma } from "@/lib/db";

/* ── Types ──────────────────────────────────────────────────── */
export interface CreateProviderInput {
  name: string;
  type?: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  availableModels?: string[];
  isDefault?: boolean;
  enabled?: boolean;
  settings?: Record<string, unknown>;
  createdBy: string;
}

export interface UpdateProviderInput {
  name?: string;
  type?: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  availableModels?: string[];
  isDefault?: boolean;
  enabled?: boolean;
  settings?: Record<string, unknown>;
}

export interface CreateConversationInput {
  title?: string;
  providerId: string;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  enableVision?: boolean;
  createdBy: string;
}

export interface UpdateConversationInput {
  title?: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  enableVision?: boolean;
}

/* ── Provider CRUD ──────────────────────────────────────────── */
export async function createProvider(input: CreateProviderInput) {
  if (!input.name.trim()) throw new Error("提供商名称不能为空");
  if (!input.apiKey.trim()) throw new Error("API Key 不能为空");

  // If this is set as default, clear other defaults
  if (input.isDefault) {
    await prisma.aiProvider.updateMany({
      where: { createdBy: input.createdBy, isDefault: true },
      data: { isDefault: false },
    });
  }

  return prisma.aiProvider.create({
    data: {
      name: input.name.trim(),
      type: (input.type as "OPENAI_COMPATIBLE") || "OPENAI_COMPATIBLE",
      apiKey: input.apiKey.trim(),
      baseUrl: input.baseUrl?.trim() || "https://api.openai.com/v1",
      defaultModel: input.defaultModel?.trim() || "gpt-4o",
      availableModels: JSON.stringify(input.availableModels ?? []),
      isDefault: input.isDefault ?? false,
      enabled: input.enabled ?? true,
      settings: JSON.stringify(input.settings ?? {}),
      createdBy: input.createdBy,
    },
  });
}

export async function listProviders(userId: string) {
  const providers = await prisma.aiProvider.findMany({
    where: { createdBy: userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  // Mask API keys for listing — only show last 4 chars
  return providers.map((p) => ({
    ...p,
    apiKey: "••••" + p.apiKey.slice(-4),
    apiKeyFull: undefined,
  }));
}

export async function getProviderById(id: string, userId: string) {
  const provider = await prisma.aiProvider.findFirst({
    where: { id, createdBy: userId },
  });
  if (!provider) throw new Error("提供商不存在");
  return provider;
}

export async function updateProvider(id: string, userId: string, input: UpdateProviderInput) {
  const existing = await getProviderById(id, userId);

  if (input.isDefault) {
    await prisma.aiProvider.updateMany({
      where: { createdBy: userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  return prisma.aiProvider.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.type !== undefined && { type: input.type as "OPENAI_COMPATIBLE" }),
      ...(input.apiKey !== undefined && { apiKey: input.apiKey.trim() }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl.trim() }),
      ...(input.defaultModel !== undefined && { defaultModel: input.defaultModel.trim() }),
      ...(input.availableModels !== undefined && { availableModels: JSON.stringify(input.availableModels) }),
      ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.settings !== undefined && { settings: JSON.stringify(input.settings) }),
    },
  });
}

export async function deleteProvider(id: string, userId: string) {
  await getProviderById(id, userId);
  return prisma.aiProvider.delete({ where: { id } });
}

/* ── Conversation CRUD ──────────────────────────────────────── */
export async function createConversation(input: CreateConversationInput) {
  const provider = await prisma.aiProvider.findFirst({
    where: { id: input.providerId, createdBy: input.createdBy, enabled: true },
  });
  if (!provider) throw new Error("提供商不存在或已禁用");

  return prisma.aiConversation.create({
    data: {
      title: input.title?.trim() || "新对话",
      providerId: input.providerId,
      model: input.model?.trim() || provider.defaultModel,
      systemPrompt: input.systemPrompt?.trim() || null,
      temperature: input.temperature ?? 0.7,
      maxTokens: input.maxTokens ?? 4096,
      topP: input.topP ?? 1.0,
      frequencyPenalty: input.frequencyPenalty ?? 0.0,
      presencePenalty: input.presencePenalty ?? 0.0,
      enableVision: input.enableVision ?? false,
      createdBy: input.createdBy,
    },
    include: { provider: true },
  });
}

export async function listConversations(userId: string) {
  return prisma.aiConversation.findMany({
    where: { createdBy: userId },
    orderBy: { updatedAt: "desc" },
    include: { provider: { select: { id: true, name: true, type: true } } },
  });
}

export async function getConversationById(id: string, userId: string) {
  const conv = await prisma.aiConversation.findFirst({
    where: { id, createdBy: userId },
    include: {
      provider: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conv) throw new Error("对话不存在");
  return conv;
}

export async function updateConversation(id: string, userId: string, input: UpdateConversationInput) {
  const existing = await prisma.aiConversation.findFirst({ where: { id, createdBy: userId } });
  if (!existing) throw new Error("对话不存在");

  return prisma.aiConversation.update({
    where: { id },
    data: {
      ...(input.title !== undefined && { title: input.title.trim() }),
      ...(input.model !== undefined && { model: input.model.trim() }),
      ...(input.systemPrompt !== undefined && { systemPrompt: input.systemPrompt?.trim() || null }),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
      ...(input.topP !== undefined && { topP: input.topP }),
      ...(input.frequencyPenalty !== undefined && { frequencyPenalty: input.frequencyPenalty }),
      ...(input.presencePenalty !== undefined && { presencePenalty: input.presencePenalty }),
      ...(input.enableVision !== undefined && { enableVision: input.enableVision }),
    },
  });
}

export async function deleteConversation(id: string, userId: string) {
 const existing = await prisma.aiConversation.findFirst({ where: { id, createdBy: userId } });
 if (!existing) throw new Error("对话不存在");
 return prisma.aiConversation.delete({ where: { id } });
}

export async function clearConversationMessages(id: string, userId: string) {
 const existing = await prisma.aiConversation.findFirst({ where: { id, createdBy: userId } });
 if (!existing) throw new Error("对话不存在");
 return prisma.aiMessage.deleteMany({ where: { conversationId: id } });
}

/* ── Messages ───────────────────────────────────────────────── */
export async function createMessage(input: {
  conversationId: string;
  role: string;
  content: string;
  reasoningContent?: string;
  imageUrls?: string[];
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}) {
  return prisma.aiMessage.create({
    data: {
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      reasoningContent: input.reasoningContent || null,
      imageUrls: JSON.stringify(input.imageUrls ?? []),
      model: input.model || null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      latencyMs: input.latencyMs ?? null,
    },
  });
}

export async function listMessages(conversationId: string) {
  return prisma.aiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
}

/* ── Fetch Models from Provider API ─────────────────────────── */
export interface AiModelInfo {
  id: string;
  name: string;
  owned_by?: string;
  /** Whether this model supports vision/image input */
  vision?: boolean;
  /** Max context tokens if reported */
  context_length?: number;
  /** Detailed capabilities of the model */
  capabilities?: ModelCapabilities;
}

export interface ModelCapabilities {
  /** Can accept image inputs */
  vision: boolean;
  /** Can accept PDF/document files */
  document: boolean;
  /** Can accept video inputs */
  video: boolean;
  /** Can accept audio inputs */
  audio: boolean;
}

export async function fetchModelsFromProvider(providerId: string, userId: string): Promise<AiModelInfo[]> {
  const provider = await prisma.aiProvider.findFirst({
    where: { id: providerId, createdBy: userId, enabled: true },
  });
  if (!provider) throw new Error("提供商不存在或已禁用");

  const baseUrl = provider.baseUrl.replace(/\/+$/, "");

  // Try the OpenAI-compatible /models endpoint
  const url = `${baseUrl}/models`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
    },
  });

  if (!response.ok) {
    // Fallback: return saved availableModels
    const saved: string[] = JSON.parse(provider.availableModels || "[]");
    if (saved.length > 0) {
      return saved.map((id) => {
        const caps = detectModelCapabilities(id);
        return { id, name: id, vision: caps.vision, capabilities: caps };
      });
    }
    // Last resort: return the default model
    const defCaps = detectModelCapabilities(provider.defaultModel);
    return [{ id: provider.defaultModel, name: provider.defaultModel, vision: defCaps.vision, capabilities: defCaps }];
  }

  const data = await response.json();
  const rawModels: Array<{ id: string; name?: string; owned_by?: string; context_length?: number }> = data.data || data.models || [];

  // Sort by id and enrich with capability detection
  const models = rawModels
    .map((m) => {
      const caps = detectModelCapabilities(m.id);
      return {
        id: m.id,
        name: m.name || m.id,
        owned_by: m.owned_by,
        vision: caps.vision,
        context_length: m.context_length,
        capabilities: caps,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  // Cache the model list back to provider
  if (models.length > 0) {
    await prisma.aiProvider.update({
      where: { id: providerId },
      data: { availableModels: JSON.stringify(models.map((m) => m.id)) },
    });
  }

  return models.length > 0
    ? models
    : (() => {
        const defCaps = detectModelCapabilities(provider.defaultModel);
        return [{ id: provider.defaultModel, name: provider.defaultModel, vision: defCaps.vision, capabilities: defCaps }];
      })();
}

/** Detect detailed capabilities of a model from its ID */
function detectModelCapabilities(modelId: string): ModelCapabilities {
 const v = modelId.toLowerCase();

 // o1/o3/o4 vision: only specific variants support images
 const isO1Vision = v.includes("o1") && !v.includes("o1-mini") && !v.includes("o1-preview") && v.includes("o1-");
 const isO3Vision = v.includes("o3") && !v.includes("o3-mini");
 const isO4Vision = v.includes("o4");

 // Vision: models that can accept images
 const vision =
 v.includes("vision") ||
 v.includes("gpt-4o") ||
 v.includes("gpt-4-turbo") ||
 v.includes("gpt4-turbo") ||
 v.includes("gpt-4e") ||
 v.includes("claude-3") ||
 v.includes("claude-3.5") ||
 v.includes("claude-4") ||
 v.includes("gemini") ||
 v.includes("qwen-vl") ||
 v.includes("qwen2-vl") ||
 v.includes("qwen2.5-vl") ||
 v.includes("glm-4v") ||
 v.includes("llava") ||
 v.includes("internvl") ||
 v.includes("cogvlm") ||
 v.includes("minicpm-v") ||
 v.includes("pixtral") ||
 isO1Vision ||
 isO3Vision ||
 isO4Vision ||
 v.includes("deepseek-vl") ||
 v.includes("yi-vision");

 // Document: models that can parse PDF/docs natively
 const document =
 v.includes("gemini-1.5") ||
 v.includes("gemini-2") ||
 v.includes("gemini-pro") ||
 v.includes("claude-3.5-sonnet") ||
 v.includes("claude-3.5-haiku") ||
 v.includes("claude-4") ||
 v.includes("gpt-4o") ||
 isO1Vision ||
 isO3Vision ||
 isO4Vision;

 // Video: models that can process video frames
 const video =
 v.includes("gemini-1.5") ||
 v.includes("gemini-2") ||
 v.includes("gemini-pro") ||
 v.includes("qwen2-vl") ||
 v.includes("qwen2.5-vl") ||
 v.includes("gpt-4o") ||
 v.includes("claude-4");

 // Audio: models that can accept audio/speech input
 const audio =
 v.includes("gemini-2") ||
 v.includes("gpt-4o-audio") ||
 v.includes("gpt-4o-realtime") ||
 isO4Vision;

  return { vision, document, video, audio };
}

/** Backward-compatible shorthand */
function isVisionModel(modelId: string): boolean {
  return detectModelCapabilities(modelId).vision;
}

/* ── Chat Proxy ─────────────────────────────────────────────── */
export interface ChatCompletionRequest {
  providerId: string;
  model: string;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  /** Extra provider-specific body fields (e.g. Anthropic "max_tokens") */
  extraBody?: Record<string, unknown>;
}

export async function sendChatRequest(req: ChatCompletionRequest, userId: string) {
  const provider = await prisma.aiProvider.findFirst({
    where: { id: req.providerId, createdBy: userId, enabled: true },
  });
  if (!provider) throw new Error("提供商不存在或已禁用");

  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url: string;
  let body: Record<string, unknown>;

  if (provider.type === "ANTHROPIC") {
    // ── Anthropic Messages API ──
    // https://docs.anthropic.com/en/api/messages
    url = `${baseUrl}/messages`;
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = "2023-06-01";

    // Extract system prompt from messages (Anthropic sends it separately)
    const systemMsg = req.messages.find((m) => m.role === "system");
    const chatMessages = req.messages.filter((m) => m.role !== "system");

    // Convert OpenAI-style content parts to Anthropic format
    const anthropicMessages = chatMessages.map((m) => {
      if (typeof m.content === "string") {
        return { role: m.role, content: m.content };
      }
      // Multimodal: convert image_url → Anthropic image blocks
      const parts: Array<{ type: string; text?: string; source?: Record<string, unknown> }> = [];
      for (const part of m.content as Array<{ type: string; text?: string; image_url?: { url: string } }>) {
        if (part.type === "text") {
          parts.push({ type: "text", text: part.text });
        } else if (part.type === "image_url" && part.image_url) {
          const imgSrc = part.image_url.url;
          if (imgSrc.startsWith("data:")) {
            // data:image/png;base64,xxxx → extract
            const match = imgSrc.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({
                type: "image",
                source: { type: "base64", media_type: match[1], data: match[2] },
              });
            }
          } else {
            parts.push({
              type: "image",
              source: { type: "url", url: imgSrc },
            });
          }
        }
      }
      return { role: m.role, content: parts };
    });

    body = {
      model: req.model,
      messages: anthropicMessages,
      ...(systemMsg && { system: typeof systemMsg.content === "string" ? systemMsg.content : "" }),
      max_tokens: req.max_tokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      top_p: req.top_p ?? 1.0,
      stream: req.stream ?? true,
    };
  } else if (provider.type === "GOOGLE") {
    // ── Google Gemini API ──
    // Use OpenAI-compatible proxy if available; otherwise native format
    url = `${baseUrl}/chat/completions`;
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
    body = {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.max_tokens ?? 4096,
      top_p: req.top_p ?? 1.0,
      stream: req.stream ?? true,
    };
  } else {
    // ── OpenAI / OpenAI-Compatible ──
    url = `${baseUrl}/chat/completions`;
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
    body = {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.max_tokens ?? 4096,
      top_p: req.top_p ?? 1.0,
      frequency_penalty: req.frequency_penalty ?? 0.0,
      presence_penalty: req.presence_penalty ?? 0.0,
      stream: req.stream ?? true,
      ...(req.extraBody || {}),
    };
  }

  const startTime = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`AI 请求失败 (${response.status}): ${errText.slice(0, 500)}`);
  }

  return { response, startTime, providerType: provider.type };
}

/* ── Serialization ──────────────────────────────────────────── */
export function serializeProvider(p: Awaited<ReturnType<typeof createProvider>>) {
  return {
    ...p,
    apiKey: p.apiKey.slice(0, 8) + "..." + p.apiKey.slice(-4),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function serializeConversation(c: Awaited<ReturnType<typeof getConversationById>>) {
  return {
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    provider: c.provider
      ? {
          ...c.provider,
          createdAt: c.provider.createdAt.toISOString(),
          updatedAt: c.provider.updatedAt.toISOString(),
        }
      : null,
    messages: c.messages.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export function serializeConversationListItem(
  c: Awaited<ReturnType<typeof listConversations>>[number]
) {
  return {
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    provider: c.provider
      ? {
          ...c.provider,
        }
      : null,
  };
}
