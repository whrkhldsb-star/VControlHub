import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission, RoleKey } from "@/lib/auth/rbac";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  aiHostedAction: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  commandRequest: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  commandTarget: {
    findMany: vi.fn(),
  },
  aiMessage: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  setting: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  ACTIVE_GENERATION,
  isActiveGenerationMarker,
  makeGenerationLease,
  parseGenerationStartedAt,
} from "../chat-generation";
import {
  getHostedActionLiveStatus,
  projectCommandOutcomeToHostedAction,
} from "../hosted-outcome";
import { toolExecutionStepUpdate } from "@/app/ai/hooks/use-ai-chat-stream";
import {
  getApprovalPolicySettings,
  invalidateApprovalPolicyCache,
} from "@/lib/command/approval-policy-settings";

describe("R19 Phase 4 review hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock));
  });

  it("issues unique timestamped generation leases so delayed continuations never age out early (Astra P1-3)", () => {
    const now = 1_795_000_000_000;
    const leaseA = makeGenerationLease(now);
    const leaseB = makeGenerationLease(now);
    expect(leaseA).not.toBe(leaseB);
    expect(isActiveGenerationMarker(leaseA)).toBe(true);
    expect(isActiveGenerationMarker(ACTIVE_GENERATION)).toBe(true);
    expect(parseGenerationStartedAt(leaseA, new Date(0))).toBe(now);
    expect(parseGenerationStartedAt(ACTIVE_GENERATION, new Date(12345))).toBe(12345);
  });

  it("skips loading CommandTarget stdout/stderr when no unsettled AiHostedAction links to the command (Astra P2-8)", async () => {
    prismaMock.commandRequest.findUnique.mockResolvedValueOnce({
      id: "cmd_plain",
      status: "COMPLETED",
    });
    prismaMock.aiHostedAction.findMany.mockResolvedValueOnce([]);

    const projected = await projectCommandOutcomeToHostedAction("cmd_plain");
    expect(projected).toBe(false);
    expect(prismaMock.commandTarget.findMany).not.toHaveBeenCalled();
  });

  it("redacts stored action.result and suppresses command details in live polling without server:read (Astra P1-6)", async () => {
    prismaMock.aiHostedAction.findFirst.mockResolvedValueOnce({
      id: "act_live_1",
      conversationId: "conv_1",
      teamId: "team_a",
      requesterId: "user_1",
      actionType: "execute_command",
      actionName: "Execute command",
      status: "COMPLETED",
      riskLevel: "high",
      effectiveRisk: "high",
      riskReasons: ["high.service_mutation"],
      decisionSource: "REQUESTER_CONFIRMED",
      modeAtDecision: "ASSISTED",
      commandRequestId: "cmd_1",
      result: JSON.stringify({
        commandRequestId: "cmd_1",
        status: "COMPLETED",
        stdout: "SECRET_OUTPUT_SHOULD_NOT_LEAK",
        stderr: "ERR_SECRET",
        targets: [{ id: "t1", stdout: "LEAK" }],
      }),
      errorMessage: null,
      createdAt: new Date("2026-11-28T00:00:00Z"),
      approvedAt: null,
      executedAt: null,
      completedAt: new Date("2026-11-28T00:01:00Z"),
      server: { id: "srv_1", name: "prod-1", host: "10.0.0.1" },
    });

    prismaMock.commandRequest.findFirst.mockResolvedValueOnce({
      id: "cmd_1",
      status: "COMPLETED",
      command: "systemctl restart nginx",
      origin: "AI_CHAT",
      riskLevel: "high",
      decisionSource: "REQUESTER_CONFIRMED",
      targets: [],
    });

    const live = await getHostedActionLiveStatus("act_live_1", {
      userId: "user_1",
      roles: [] as RoleKey[],
      permissions: ["ai:chat" as Permission], // no server:read
      currentTeamId: "team_a",
    });

    expect(live).not.toBeNull();
    if (!live) throw new Error("expected live status");
    expect(live.command?.targets).toEqual([]);
    expect(live.action.server).toBeNull();
    // Without server:read, target selection is forced to an empty set so no server names or stdout/stderr are ever loaded.
    expect(prismaMock.commandRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          targets: expect.objectContaining({
            where: { id: { in: [] } },
          }),
        }),
      }),
    );
    expect(live.action.result).toBeTruthy();
    expect(live.action.result).not.toContain("SECRET_OUTPUT_SHOULD_NOT_LEAK");
    expect(live.action.result).not.toContain("ERR_SECRET");
    const parsed = JSON.parse(live.action.result!);
    expect(parsed).toMatchObject({ commandRequestId: "cmd_1", status: "COMPLETED" });
    expect(parsed.stdout).toBeNull();
    expect(parsed.stderr).toBeNull();
    expect(parsed.targets).toBeUndefined();
  });

  it("maps tool_execution awaiting_review frames to awaiting state instead of running (Astra P2-1)", () => {
    const update = toolExecutionStepUpdate({
      toolCallId: "tc_review",
      actionId: "act_review",
      commandRequestId: "cmd_review",
      phase: "awaiting_review",
      effectiveRisk: "high",
      decisionSource: "AI_MODE_AUTO",
    });
    expect(update).toEqual({
      toolCallId: "tc_review",
      auto: true,
      phase: "awaiting_review",
      state: "awaiting",
      actionId: "act_review",
      commandRequestId: "cmd_review",
      riskLevel: "high",
      decisionSource: "AI_MODE_AUTO",
    });
  });

  it("drops stale in-flight approval-policy cache writes after invalidation (Carbon P2-4)", async () => {
    invalidateApprovalPolicyCache();
    let resolveStale!: (rows: Array<{ key: string; value: string }>) => void;
    const stalePromise = new Promise<Array<{ key: string; value: string }>>((resolve) => {
      resolveStale = resolve;
    });
    prismaMock.setting.findMany
      .mockReturnValueOnce(stalePromise)
      .mockResolvedValueOnce([{ key: "command.approvalPolicy", value: "always" }]);

    const first = getApprovalPolicySettings();
    // Policy updated & cache invalidated while the first DB read is still in flight.
    invalidateApprovalPolicyCache();
    resolveStale([{ key: "command.approvalPolicy", value: "never" }]);
    await first;

    // Next read MUST NOT see the stale "never" value; it must re-read "always".
    const fresh = await getApprovalPolicySettings();
    expect(fresh.commandApprovalPolicy).toBe("always");
    expect(prismaMock.setting.findMany).toHaveBeenCalledTimes(2);
    invalidateApprovalPolicyCache();
  });
});
