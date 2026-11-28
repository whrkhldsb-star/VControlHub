/* ── AI Chat Types ──────────────────────────────────────────── */

import type { AutomationMode } from "./ai-automation-mode";

export type { AutomationMode } from "./ai-automation-mode";

export interface Provider {
  id: string;
  name: string;
  type: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel: string;
  availableModels: string;
  isDefault: boolean;
  enabled: boolean;
  settings?: string;
  createdAt?: string;
  updatedAt?: string;
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
 automationMode?: AutomationMode;
 /** When a Full auto window ends (ISO); null outside Full auto. */
 automationModeExpiresAt?: string | null;
 /** Servers the assistant should act on first; Auto and Full auto run only on these when any are pinned. */
 pinnedServerIds?: string[];
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
  requiresLocalFiles?: boolean;
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
  // Gemini's OpenAI-compatible surface, which the GOOGLE branch speaks
  // (/chat/completions, /models with a Bearer key): the bare /v1beta root
  // answered both with 404.
  GOOGLE: "https://generativelanguage.googleapis.com/v1beta/openai",
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
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
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
/** Slash-command ids; label `aiPage.slash.<id>` and composer text `aiPage.slashPrompt.<id>` live in the dictionary. */
export const SLASH_COMMAND_IDS = ["status", "logs", "traffic", "disk", "cmd", "playbook"] as const;
export type SlashCommandId = (typeof SLASH_COMMAND_IDS)[number];

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
 automationMode: "ASSISTED" as AutomationMode,
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
 /** Risk after re-classifying the final command (absent on cards older than R19). */
 effectiveRisk?: string | null;
 /** Classifier reason codes, e.g. "critical.destructive_rm_root". */
 riskReasons?: unknown;
 /** How the linked command was let through: REQUESTER_CONFIRMED, SELF_REVIEW, AI_MODE_AUTO… */
 decisionSource?: string | null;
 modeAtDecision?: string | null;
 commandRequestId?: string | null;
 autoApproved: boolean;
 result: string | null;
 errorMessage: string | null;
 createdAt: string;
 approvedAt: string | null;
 executedAt: string | null;
 completedAt: string | null;
 server: { id: string; name: string; host: string } | null;
}

export type HostedActionStatus = HostedAction["status"];

/** One target of the command behind a hosted action, as GET /api/ai/hosted-actions/[id] reports it (output masked). */
export interface HostedActionLiveTarget {
 id: string;
 serverId: string;
 serverName: string | null;
 status: string;
 exitCode: number | null;
 outcomeUnknown: boolean;
 stdout: string | null;
 stderr: string | null;
 finishedAt: string | null;
}

/** GET /api/ai/hosted-actions/[id]: the action, and the command it became (null before it is created). */
export interface HostedActionLive {
 action: {
  id: string;
  status: HostedActionStatus;
  actionType?: string;
  actionName?: string;
  errorMessage?: string | null;
  commandRequestId?: string | null;
  effectiveRisk?: string | null;
  decisionSource?: string | null;
  server?: { id: string; name: string; host: string } | null;
 };
 command: {
  id: string;
  status: string;
  command: string;
  origin: string | null;
  riskLevel: string | null;
  decisionSource: string | null;
  targets: HostedActionLiveTarget[];
 } | null;
}

/** A server the pinned-server picker offers (scoped to the account, `server:read` only). */
export interface AiServerOption {
 id: string;
 name: string;
 host: string;
}

export interface ToolCallEvent {
 id: string;
 name: string;
 args: Record<string, unknown>;
 riskLevel: string;
 autoApproved: boolean;
 actionName: string;
 /** Absent from servers before 2026-11: the step then shows `actionName` as it is. */
 actionType?: string;
}

/**
 * One tool call while an answer streams, as the stream reports it: called (running, or waiting for approval),
 * then answered. A call the server answers without naming it first (an unknown tool) has no name.
 */
export interface StreamStep {
 toolCallId: string;
 actionType?: string;
 name: string | null;
 state: "running" | "awaiting" | "succeeded" | "failed";
 riskLevel?: string;
 /** The hosted action behind the call, once the server names it. */
 actionId?: string;
 /** Run by Auto / Full auto without a confirmation card (a `tool_execution` frame). */
 auto?: boolean;
 /** Where an automatically run command is: `timeout` means the server stopped waiting, the command did not; `awaiting_review` means policy routed it for approval instead of running immediately. */
 phase?: "running" | "completed" | "failed" | "timeout" | "awaiting_review";
 decisionSource?: string;
 commandRequestId?: string;
 exitCode?: number | null;
 /** How many entries a list-shaped result held. */
 resultCount?: number;
 /** What went wrong, when the result says. */
 error?: string;
 /** The (server-masked) output or data the call returned, shortened for the timeline. */
 output?: string;
}

export interface ToolApprovalNeeded {
 toolCallId: string;
 actionId: string;
  actionName: string;
  actionType: string;
 riskLevel: string;
 params: Record<string, unknown>;
 /** The server the action is bound to, by name: the card showed only its internal id. */
 server?: { name: string; host: string } | null;
 /** Risk after classifying the proposed command (the stream sends it as `effectiveRisk`). */
 effectiveRisk?: string;
 riskReasons?: string[];
 /** Matches the catastrophic-command denylist: confirming needs an explicit acknowledgement. */
 denylisted?: boolean;
 /** The stream's answer to "does confirming run it now?"; absent on cards restored from history. */
 willExecuteInline?: boolean;
}
