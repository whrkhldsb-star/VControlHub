import type { Message, ToolApprovalNeeded } from "./ai-types";

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

export function pendingApprovalsFromMessages(
  messages: Message[],
): ToolApprovalNeeded[] {
  return messages.flatMap((message) =>
    (message.hostedActions ?? [])
      .filter((action) => action.status === "PENDING_APPROVAL")
      .map((action) => ({
        toolCallId: action.toolCallId ?? action.id,
        actionId: action.id,
        actionName: action.actionName,
        actionType: action.actionType,
        riskLevel: action.riskLevel,
        params: parseParams(action.params),
      })),
  );
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

const APPROVAL_TEXT_LIMIT = 2_000;

function text(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * What a person must see to approve an action: the card used to show only the action's name, its risk and a raw server
 * id, so a command, a file's new content or a playbook was approved unseen (the chat text is whatever the model said,
 * not what will run).
 */
export function approvalDetails(actionType: string, params: Record<string, unknown>): ApprovalDetail[] {
  const rows: ApprovalDetail[] = [];
  const add = (labelKey: string, value: string | null, block = false) => {
    if (value === null) return;
    rows.push({ labelKey, value: value.length > APPROVAL_TEXT_LIMIT ? `${value.slice(0, APPROVAL_TEXT_LIMIT)}…` : value, block });
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
      add("aiPage.approvalConfigContent", text(params, "content"), true);
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
          add("aiPage.approvalEnvNames", names.length > 0 ? names.join(", ") : null);
        } catch {
          add("aiPage.approvalEnvNames", null);
        }
      }
      break;
    }
    case "run_playbook":
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
