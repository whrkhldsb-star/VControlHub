import type { HostedAction, HostedActionStatus, Message, ToolApprovalNeeded } from "./ai-types";

function parseParams(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Classifier reason codes as stored (a JSON array) or streamed; anything else is dropped. */
export function parseRiskReasons(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((reason): reason is string => typeof reason === "string" && reason.length > 0);
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      return parseRiskReasons(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

export function pendingApprovalsFromMessages(
  messages: Message[],
): ToolApprovalNeeded[] {
  return messages.flatMap((message) =>
    (message.hostedActions ?? [])
      .filter((action) => action.status === "PENDING_APPROVAL")
      .map((action) => {
        const riskReasons = parseRiskReasons(action.riskReasons);
        const effectiveRisk = action.effectiveRisk || action.riskLevel;
        return {
          toolCallId: action.toolCallId ?? action.id,
          actionId: action.id,
          actionName: action.actionName,
          actionType: action.actionType,
          riskLevel: effectiveRisk,
          params: parseParams(action.params),
          server: action.server ? { name: action.server.name, host: action.server.host } : null,
          ...(action.effectiveRisk ? { effectiveRisk: action.effectiveRisk } : {}),
          ...(riskReasons.length > 0 ? { riskReasons } : {}),
          ...(riskReasons.some((reason) => reason.startsWith("critical.")) ? { denylisted: true } : {}),
        };
      }),
  );
}

/**
 * A card that needs the explicit "I understand" acknowledgement: critical risk, a denylisted command, or a
 * critical classifier reason. The server files such a command for peer review unless it was acknowledged.
 */
export function isCriticalApproval(approval: Pick<ToolApprovalNeeded, "riskLevel" | "effectiveRisk" | "riskReasons" | "denylisted">): boolean {
  const risk = (approval.effectiveRisk || approval.riskLevel || "").toLowerCase();
  return risk === "critical"
    || approval.denylisted === true
    || (approval.riskReasons ?? []).some((reason) => reason.startsWith("critical."));
}

export const TERMINAL_ACTION_STATUSES: ReadonlySet<HostedActionStatus> = new Set<HostedActionStatus>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
]);

export function isTerminalActionStatus(status: string | null | undefined): boolean {
  return Boolean(status) && TERMINAL_ACTION_STATUSES.has(status as HostedActionStatus);
}

/** The CommandRequest behind an action: its own column, or (older cards) the id recorded in its result. */
export function hostedActionCommandRequestId(action: Pick<HostedAction, "commandRequestId" | "result">): string | null {
  if (action.commandRequestId) return action.commandRequestId;
  if (!action.result) return null;
  try {
    const parsed: unknown = JSON.parse(action.result);
    const id = parsed && typeof parsed === "object" ? (parsed as { commandRequestId?: unknown }).commandRequestId : null;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/** Messages the page made up (an optimistic user bubble, a streamed reply, an error bubble): the server has none. */
function isLocalMessage(message: Pick<Message, "id">): boolean {
  return message.id.startsWith("temp-") || message.id.startsWith("stream-");
}

export type ContinuationCandidate = {
  /** The assistant message whose tool calls are waiting for the model. */
  messageId: string;
  actionIds: string[];
  /** Every action is final: POST /continue is accepted. */
  settled: boolean;
};

/**
 * Whether the conversation stopped at an assistant turn whose actions the model has not seen the outcome of —
 * the state POST /api/ai/conversations/[id]/continue resumes from. Only the last saved message counts: once
 * the user wrote again (or the model answered), there is nothing to continue.
 */
export function continuationCandidate(messages: Message[]): ContinuationCandidate | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "tool" || isLocalMessage(message)) continue;
    if (message.role !== "assistant") return null;
    const actions = message.hostedActions ?? [];
    if (actions.length === 0) return null;
    return {
      messageId: message.id,
      actionIds: actions.map((action) => action.id),
      settled: actions.every((action) => isTerminalActionStatus(action.status)),
    };
  }
  return null;
}

const COUNTABLE_RESULT_FIELDS = ["servers", "containers", "results", "items", "files", "entries", "logs", "templates", "tasks", "backups", "playbooks", "matches", "lines"];
const OUTPUT_PREVIEW_CHARS = 1200;

function tail(text: string, chars: number): string {
  return text.length > chars ? `…${text.slice(-chars)}` : text;
}

/**
 * What the live timeline says about a tool call's answer: the stream's `tool_result.data`. Command outcomes
 * carry an exit code and masked output; read tools return data of their own shape, counted where it is a list.
 */
export function summarizeToolData(data: unknown): {
  count?: number;
  exitCode?: number | null;
  error?: string;
  output?: string;
} {
  if (data === null || data === undefined) return {};
  if (typeof data === "string") return data.trim() ? { output: tail(data, OUTPUT_PREVIEW_CHARS) } : {};
  if (Array.isArray(data)) return { count: data.length, ...(data.length > 0 ? { output: tail(JSON.stringify(data, null, 2), OUTPUT_PREVIEW_CHARS) } : {}) };
  if (typeof data !== "object") return { output: String(data) };
  const record = data as Record<string, unknown>;
  const result: { count?: number; exitCode?: number | null; error?: string; output?: string } = {};
  if (typeof record.error === "string" && record.error.trim()) result.error = record.error.trim().slice(0, 500);
  const looksLikeCommand = "exitCode" in record || "stdout" in record || "stderr" in record;
  if (looksLikeCommand) {
    result.exitCode = typeof record.exitCode === "number" ? record.exitCode : null;
    const stdout = typeof record.stdout === "string" ? record.stdout : "";
    const stderr = typeof record.stderr === "string" ? record.stderr : "";
    const combined = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n");
    if (combined) result.output = tail(combined, OUTPUT_PREVIEW_CHARS);
    return result;
  }
  for (const field of COUNTABLE_RESULT_FIELDS) {
    const value = record[field];
    if (Array.isArray(value)) {
      result.count = value.length;
      break;
    }
  }
  const keys = Object.keys(record).filter((key) => key !== "error");
  if (keys.length > 0) result.output = tail(JSON.stringify(record, null, 2), OUTPUT_PREVIEW_CHARS);
  return result;
}

/** Actions the transcript shows as decided or finished: a streamed card for one of them is out of date. */
export function settledActionIds(messages: Message[]): Set<string> {
  return new Set(
    messages.flatMap((message) =>
      (message.hostedActions ?? []).filter((action) => action.status !== "PENDING_APPROVAL").map((action) => action.id),
    ),
  );
}

export type ApprovalDetail = {
  labelKey: string;
  value: string;
  /** Long or multi-line text (a command, a file's new content) shown in its own box. */
  block?: boolean;
};

function text(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * What a person must see to approve an action: the card used to show only the action's name, its risk and a raw server
 * id, so a command, a file's new content or a playbook was approved unseen (the chat text is whatever the model said,
 * not what will run).
 */
export function approvalDetails(
  actionType: string,
  params: Record<string, unknown>,
  /** Between the names of a list, in the page's language (`common.listSeparator`). */
  listSeparator = ", ",
): ApprovalDetail[] {
  const rows: ApprovalDetail[] = [];
  const add = (labelKey: string, value: string | null, block = false) => {
    if (value === null) return;
    rows.push({ labelKey, value, block });
  };
  switch (actionType) {
    case "execute_command":
      add("aiPage.approvalCommand", text(params, "command"), true);
      break;
    case "restart_service":
      add("aiPage.approvalService", text(params, "serviceName"));
      break;
    case "modify_config":
      add("aiPage.approvalConfigPath", text(params, "configPath"));
      add("aiPage.approvalConfigContent", typeof params.content === "string" ? params.content : null, true);
      break;
    case "deploy_docker": {
      add("aiPage.approvalImage", text(params, "imageName"));
      add("aiPage.approvalContainer", text(params, "containerName"));
      add("aiPage.approvalPorts", text(params, "ports"));
      // Names only: the values are secrets as often as not.
      const envVars = text(params, "envVars");
      if (envVars) {
        try {
          const parsed: unknown = JSON.parse(envVars);
          const names = Array.isArray(parsed) ? [] : parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
          add("aiPage.approvalEnvNames", names.length > 0 ? names.join(listSeparator) : null);
        } catch {
          add("aiPage.approvalEnvNames", null);
        }
      }
      break;
    }
    case "run_playbook":
      if (Array.isArray(params.targetServerIds)) add("aiPage.automationTargets", params.targetServerIds.join(listSeparator));
      add("aiPage.approvalPlaybook", text(params, "playbookName") ?? text(params, "playbookId"));
      break;
    case "manage_cron":
      add("aiPage.approvalTask", text(params, "taskId"));
      add("aiPage.approvalOperation", text(params, "action"));
      break;
    default:
      break;
  }
  add("aiPage.approvalReason", text(params, "reason"));
  return rows;
}

/** Server names listed on an automation card before the rest are counted. */
const AUTOMATION_TARGET_NAMES = 8;

/**
 * When an automation plan runs, on which servers and under which approval, in words. The card showed the raw
 * values ("once", "every_run") and a server count: neither the time of a scheduled run nor the names of its
 * targets, which is what the person is asked to confirm.
 */
export function automationSummary(
  params: Record<string, unknown>,
  t: (key: string, vars?: Record<string, string | number>) => string,
  formatTime: (value: string) => string,
): { execution: string; targets: string; approval: string } {
  const mode = text(params, "executionMode");
  const zone = text(params, "timeZone") ?? "";
  const runAt = text(params, "runAt");
  const dailyTime = text(params, "dailyTime");
  const execution = mode === "now"
    ? t("aiPage.automationSchedule.now")
    : mode === "once" && runAt
      ? t("aiPage.automationSchedule.once", { time: formatTime(runAt), zone })
      : mode === "daily" && dailyTime
        ? t("aiPage.automationSchedule.daily", { time: dailyTime, zone })
        : (mode ?? "-");

  const names = Array.isArray(params.servers)
    ? params.servers.flatMap((server) => {
        const name = server && typeof server === "object" ? (server as { name?: unknown }).name : null;
        return typeof name === "string" && name.trim() ? [name] : [];
      })
    : [];
  const count = Array.isArray(params.serverIds) ? params.serverIds.length : names.length;
  const shown = names.slice(0, AUTOMATION_TARGET_NAMES);
  const targets = shown.length === 0
    ? String(count)
    : count > shown.length
      ? t("aiPage.automationTargetNamesMore", { count, names: shown.join(t("common.listSeparator")), more: count - shown.length })
      : t("aiPage.automationTargetNames", { count, names: shown.join(t("common.listSeparator")) });

  const approvalMode = text(params, "approvalMode");
  const approval = approvalMode === "approve_once"
    ? t("aiPage.automationApproval.approveOnce")
    : approvalMode === "every_run"
      ? t("aiPage.automationApproval.everyRun")
      : (approvalMode ?? "-");
  return { execution, targets, approval };
}

export function mergePendingApprovals(
  streamed: ToolApprovalNeeded[],
  persisted: ToolApprovalNeeded[],
): ToolApprovalNeeded[] {
  const byActionId = new Map<string, ToolApprovalNeeded>();
  for (const approval of [...persisted, ...streamed]) {
    byActionId.set(approval.actionId, approval);
  }
  return [...byActionId.values()];
}
