import { describe, expect, it } from "vitest";

import {
  mergePendingApprovals,
  pendingApprovalsFromMessages,
} from "../ai-hosted-action-utils";
import type { Message } from "../ai-types";

describe("AI hosted action UI state", () => {
  it("rehydrates pending approvals from persisted conversation messages", () => {
    const messages = [
      {
        id: "message-1",
        hostedActions: [
          {
            id: "action-1",
            toolCallId: "tool-1",
            actionName: "Manage scheduled tasks",
            actionType: "manage_cron",
            riskLevel: "medium",
            status: "PENDING_APPROVAL",
            params: JSON.stringify({ action: "pause", taskId: "task-1" }),
          },
          {
            id: "action-2",
            status: "COMPLETED",
          },
        ],
      },
    ] as Message[];

    expect(pendingApprovalsFromMessages(messages)).toEqual([
      {
        toolCallId: "tool-1",
        actionId: "action-1",
        actionName: "Manage scheduled tasks",
        actionType: "manage_cron",
        riskLevel: "medium",
        params: { action: "pause", taskId: "task-1" },
      },
    ]);
  });

  it("deduplicates streamed and persisted copies of the same action", () => {
    const persisted = {
      toolCallId: "tool-1",
      actionId: "action-1",
      actionName: "Persisted",
      actionType: "execute_command",
      riskLevel: "medium",
      params: {},
    };
    const streamed = { ...persisted, actionName: "Streamed" };

    expect(mergePendingApprovals([streamed], [persisted])).toEqual([streamed]);
  });
});
