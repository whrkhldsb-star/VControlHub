/* ── AI Chat Types ──────────────────────────────────────────── */

export interface Provider {
  id: string;
  name: string;
  type: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  availableModels: string;
  isDefault: boolean;
  enabled: boolean;
  settings: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConvItem {
 id: string;
 title: string;
 providerId: string;
 model: string;
 systemPrompt: string | null;
 temperature: number;
 maxTokens: number;
 topP: number;
 frequencyPenalty: number;
 presencePenalty: number;
 enableVision: boolean;
 hostingEnabled: boolean;
 automationMode?: "ASSISTED" | "PLAN_ONLY";
 createdBy: string;
 createdAt: string;
 updatedAt: string;
 provider: { id: string; name: string; type: string } | null;
}

export interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  reasoningContent: string | null;
  imageUrls: string;
  toolCalls?: string;
  toolCallId?: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
  hostedActions?: HostedAction[];
}

export interface ModelInfo {
  id: string;
  name: string;
  owned_by?: string;
  vision?: boolean;
  context_length?: number;
  capabilities?: ModelCapabilities;
}

export interface ModelCapabilities {
  vision: boolean;
  document: boolean;
  video: boolean;
  audio: boolean;
}

export interface FileAttachment {
  name: string;
  content: string;
  type: "text" | "image" | "video" | "audio" | "document";
  mimeType: string;
  base64Data?: string;
  preview?: string;
}

export type FileCategory = "image" | "video" | "audio" | "document" | "text" | "unsupported";

export const PROVIDER_TYPES: Record<string, string> = {
  OPENAI: "OpenAI",
  OPENAI_COMPATIBLE: "OpenAI Compatible",
  ANTHROPIC: "Anthropic",
  GOOGLE: "Google AI",
  CUSTOM: "Custom",
};

export const COMMON_BASE_URLS: Record<string, string> = {
  OPENAI: "https://api.openai.com/v1",
  ANTHROPIC: "https://api.anthropic.com/v1",
  GOOGLE: "https://generativelanguage.googleapis.com/v1beta",
};

/**
 * Provider onboarding presets: one click fills type / base URL / name /
 * recommended models so the user only has to paste an API key (or nothing at
 * all for a local endpoint). Labels are translated via `aiPage.preset.<id>`.
 */
export const PROVIDER_PRESETS: Array<{
  id: string;
  type: keyof typeof PROVIDER_TYPES;
  name: string;
  baseUrl: string;
  /** Pre-filled model candidates; replaced by the live probe when it works. */
  models: string[];
  /** Where the user creates an API key (omitted for local endpoints). */
  apiKeyUrl?: string;
  /** Local endpoints need no key — create is one click. */
  local?: boolean;
}> = [
  {
    id: "deepseek",
    type: "OPENAI_COMPATIBLE",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "openai",
    type: "OPENAI",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    apiKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "zhipu",
    type: "OPENAI_COMPATIBLE",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-plus", "glm-4-flash"],
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "moonshot",
    type: "OPENAI_COMPATIBLE",
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k"],
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "anthropic",
    type: "ANTHROPIC",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    models: ["claude-sonnet-4-5", "claude-opus-4-1"],
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "ollama",
    type: "OPENAI_COMPATIBLE",
    name: "Ollama 本地",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: ["qwen3:8b", "llama3.1:8b"],
    local: true,
  },
];

/**
 * Slash-command starters for the composer. `prompt` is what gets inserted;
 * labels resolve via `aiPage.slash.<id>`.
 */
export const SLASH_COMMANDS: Array<{ id: string; prompt: string }> = [
  { id: "status", prompt: "查看所有服务器的当前状态，汇总 CPU / 内存 / 磁盘占用和告警。" },
  { id: "logs", prompt: "帮我读取服务器 的最近日志，分析有没有异常。" },
  { id: "traffic", prompt: "查询最近的流量数据，指出异常波动和可能的优化空间。" },
  { id: "disk", prompt: "列出各服务器磁盘占用最高的目录，并给出清理建议。" },
  { id: "cmd", prompt: "我想在服务器 上执行以下命令，请先评估风险再帮我执行：" },
  { id: "playbook", prompt: "列出可用的 Playbook，并推荐一个适合日常巡检的。" },
];

export const DEFAULT_PROV_FORM = {
  name: "",
  type: "OPENAI_COMPATIBLE",
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  defaultModel: "gpt-4o",
  availableModels: "",
  isDefault: true,
};

export const DEFAULT_SETTINGS_FORM = {
 model: "",
 systemPrompt: "",
 temperature: 0.7,
 maxTokens: 4096,
 topP: 1.0,
 frequencyPenalty: 0.0,
 presencePenalty: 0.0,
 enableVision: false,
 hostingEnabled: false,
 automationMode: "ASSISTED" as "ASSISTED" | "PLAN_ONLY",
};

/* ── AI 托管操作类型 ───────────────────────────────────────── */

export interface HostedAction {
 id: string;
 conversationId: string;
 messageId: string;
 toolCallId: string | null;
 serverId: string | null;
 actionType: string;
 actionName: string;
 params: string;
 status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXECUTING" | "COMPLETED" | "FAILED" | "CANCELLED";
 riskLevel: string;
 autoApproved: boolean;
 result: string | null;
 errorMessage: string | null;
 createdAt: string;
 approvedAt: string | null;
 executedAt: string | null;
 completedAt: string | null;
 server: { id: string; name: string; host: string } | null;
}

export interface ToolCallEvent {
 id: string;
 name: string;
 args: Record<string, unknown>;
 riskLevel: string;
 autoApproved: boolean;
 actionName: string;
}

export interface ToolApprovalNeeded {
 toolCallId: string;
 actionId: string;
  actionName: string;
  actionType: string;
 riskLevel: string;
 params: Record<string, unknown>;
}
