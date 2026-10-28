import { describe, expect, it } from "vitest";

import {
  approvalDetails,
  mergePendingApprovals,
  pendingApprovalsFromMessages,
  settledActionIds,
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

describe("approvalDetails", () => {
  it("lists what each action will do, and truncates very long text", () => {
    expect(approvalDetails("restart_service", { serviceName: "nginx", reason: "config changed" })).toEqual([
      { labelKey: "aiPage.approvalService", value: "nginx", block: false },
      { labelKey: "aiPage.approvalReason", value: "config changed", block: false },
    ]);
    const [row] = approvalDetails("execute_command", { command: "x".repeat(5_000) });
    expect(row!.block).toBe(true);
    expect(row!.value.length).toBeLessThan(2_100);
    expect(approvalDetails("list_servers", {})).toEqual([]);
  });

  it("shows environment variable names only, and survives text that is not JSON", () => {
    expect(approvalDetails("deploy_docker", { imageName: "redis:7", envVars: JSON.stringify({ A: "1", B: "2" }) }).find((row) => row.labelKey === "aiPage.approvalEnvNames")?.value).toBe("A, B");
    expect(approvalDetails("deploy_docker", { imageName: "redis:7", envVars: "A=1" }).some((row) => row.labelKey === "aiPage.approvalEnvNames")).toBe(false);
  });
});

describe("settledActionIds", () => {
  it("names the actions the transcript shows as no longer pending", () => {
    const messages = [
      { id: "m1", hostedActions: [{ id: "a", status: "PENDING_APPROVAL" }, { id: "b", status: "COMPLETED" }, { id: "c", status: "REJECTED" }] },
      { id: "m2" },
    ] as unknown as Message[];
    expect([...settledActionIds(messages)].sort()).toEqual(["b", "c"]);
  });
});
