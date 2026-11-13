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
            id: "action-3",
            toolCallId: "tool-3",
            actionName: "Restart service",
            actionType: "restart_service",
            riskLevel: "high",
            status: "PENDING_APPROVAL",
            params: JSON.stringify({ serviceName: "nginx", serverId: "srv-1" }),
            server: { id: "srv-1", name: "web-1", host: "10.0.0.1" },
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
        server: null,
      },
      {
        toolCallId: "tool-3",
        actionId: "action-3",
        actionName: "Restart service",
        actionType: "restart_service",
        riskLevel: "high",
        params: { serviceName: "nginx", serverId: "srv-1" },
        // By name: the card showed the internal id, which tells a person nothing about which server it is.
        server: { name: "web-1", host: "10.0.0.1" },
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

describe("automationSummary", () => {
  const t = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? JSON.stringify(vars) : ""}`;
  const formatTime = (value: string) => `fmt(${value})`;

  it("says when a plan runs, on which servers and under which approval", async () => {
    // The card printed "once", a server count and "every_run": the time and the targets' names, which are what
    // the person confirms, were not on it.
    const { automationSummary } = await import("../ai-hosted-action-utils");
    const servers = Array.from({ length: 10 }, (_, index) => ({ id: `s${index}`, name: `node-${index}`, host: "h" }));
    const once = automationSummary({ executionMode: "once", runAt: "2030-01-14T19:00:00.000Z", timeZone: "Asia/Shanghai", approvalMode: "every_run", serverIds: servers.map((s) => s.id), servers }, t, formatTime);
    expect(once.execution).toBe('aiPage.automationSchedule.once{"time":"fmt(2030-01-14T19:00:00.000Z)","zone":"Asia/Shanghai"}');
    expect(once.approval).toBe("aiPage.automationApproval.everyRun");
    expect(once.targets).toBe('aiPage.automationTargetNamesMore{"count":10,"names":"node-0, node-1, node-2, node-3, node-4, node-5, node-6, node-7","more":2}');

    const daily = automationSummary({ executionMode: "daily", dailyTime: "03:30", timeZone: "Asia/Shanghai", approvalMode: "approve_once", serverIds: ["s0"], servers: servers.slice(0, 1) }, t, formatTime);
    expect(daily.execution).toBe('aiPage.automationSchedule.daily{"time":"03:30","zone":"Asia/Shanghai"}');
    expect(daily.approval).toBe("aiPage.automationApproval.approveOnce");
    expect(daily.targets).toBe('aiPage.automationTargetNames{"count":1,"names":"node-0"}');

    expect(automationSummary({ executionMode: "now", serverIds: ["s0", "s1"] }, t, formatTime)).toEqual({ execution: "aiPage.automationSchedule.now", targets: "2", approval: "-" });
  });
});
