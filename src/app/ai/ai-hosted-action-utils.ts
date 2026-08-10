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
