import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    prisma: {
      aiOpsLog: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

import { approveRecommendation } from "../service";

const baseLog = {
  id: "log-1",
  triggerType: "manual",
  mode: "recommendation",
  status: "ok",
  findings: [],
  actions: [
    {
      id: "act-1",
      action: "restart-service",
      risk: "medium",
      requiresApproval: true,
    },
  ],
  notes: null,
  errorMessage: null,
  providerId: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
  triggeredById: "user-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("approveRecommendation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.aiOpsLog.findUnique.mockResolvedValue(baseLog);
    mocks.prisma.aiOpsLog.updateMany.mockResolvedValue({ count: 1 });
  });

  it("happy path: marks the recommendation as approved via atomic updateMany", async () => {
    const result = await approveRecommendation({ logId: "log-1", actionId: "act-1" });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.aiOpsLog.updateMany).toHaveBeenCalledTimes(1);
    const callArgs = mocks.prisma.aiOpsLog.updateMany.mock.calls[0] as unknown as [
      { where: { id: string; updatedAt: Date }; data: { actions: unknown[] } },
    ];
    const args = callArgs[0];
    // CAS guard: where clause pins both id and updatedAt
    expect(args.where).toEqual({ id: "log-1", updatedAt: baseLog.updatedAt });
    // The approved action is now flagged in the persisted actions array
    const persistedActions = args.data.actions as { id: string; approved?: boolean }[];
    expect(persistedActions.find((a) => a.id === "act-1")?.approved).toBe(true);
  });

  it("rejects an already-approved recommendation", async () => {
    mocks.prisma.aiOpsLog.findUnique.mockResolvedValue({
      ...baseLog,
      actions: [
        {
          id: "act-1",
          action: "restart-service",
          risk: "medium",
          requiresApproval: true,
          approved: true,
        },
      ],
    });

    const result = await approveRecommendation({ logId: "log-1", actionId: "act-1" });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain("already been approved");
    expect(mocks.prisma.aiOpsLog.updateMany).not.toHaveBeenCalled();
  });

  it("returns an error when the CAS guard loses the race (updateMany count 0)", async () => {
    mocks.prisma.aiOpsLog.updateMany.mockResolvedValue({ count: 0 });

    const result = await approveRecommendation({ logId: "log-1", actionId: "act-1" });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain("another approver");
  });

  it("returns an error when the log is not found", async () => {
    mocks.prisma.aiOpsLog.findUnique.mockResolvedValue(null);

    const result = await approveRecommendation({ logId: "missing", actionId: "act-1" });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Log not found");
  });

  it("returns an error when the action does not require approval", async () => {
    mocks.prisma.aiOpsLog.findUnique.mockResolvedValue({
      ...baseLog,
      actions: [
        { id: "act-1", action: "read-only", risk: "low", requiresApproval: false },
      ],
    });

    const result = await approveRecommendation({ logId: "log-1", actionId: "act-1" });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain("does not require approval");
  });
});