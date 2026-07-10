import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    setting: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const {
  getRuntimeSettingNumber,
  getCommandRuntimeConfig,
  getSshTerminalRuntimeConfig,
  getOperationTaskListLimit,
  getAiProviderListLimit,
  getAiConversationListLimit,
  getRuntimeSettingFallback,
  getRuntimeSettingSummaries,
  normalizeRuntimeSettingValue,
} = await import("./service");

describe("runtime settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COMMAND_EXECUTION_TIMEOUT_MS;
  });

  it("prefers persisted runtime settings over env/default fallbacks", async () => {
    process.env.COMMAND_EXECUTION_TIMEOUT_MS = "12345";
    prismaMock.setting.findUnique.mockResolvedValueOnce({ value: "45000" });

    await expect(getRuntimeSettingNumber("runtime.commandExecutionTimeoutMs")).resolves.toBe(45000);
    expect(prismaMock.setting.findUnique).toHaveBeenCalledWith({
      where: { key: "runtime.commandExecutionTimeoutMs" },
      select: { value: true },
    });
  });

  it("falls back to env when the setting row is absent", async () => {
    process.env.COMMAND_EXECUTION_TIMEOUT_MS = "12345";
    prismaMock.setting.findUnique.mockResolvedValueOnce(null);

    await expect(getRuntimeSettingNumber("runtime.commandExecutionTimeoutMs")).resolves.toBe(12345);
  });

  it("normalizes command runtime config with a stale window no lower than execution timeout", async () => {
    prismaMock.setting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => ({
      value: where.key === "runtime.commandStaleRunningAfterMs" ? "30000" : "60000",
    }));

    await expect(getCommandRuntimeConfig()).resolves.toMatchObject({
      executionTimeoutMs: 60000,
      staleRunningAfterMs: 30000,
    });
  });

  it("rejects out-of-range runtime values", () => {
    expect(() => normalizeRuntimeSettingValue("runtime.commandExecutionTimeoutMs", "1")).toThrow(/must be between/);
  });

  it("reads SSH terminal keepalive settings from persisted runtime settings", async () => {
    prismaMock.setting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => ({
      value: where.key === "runtime.sshIdleTimeoutSec" ? "600" : "15000",
    }));

    await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({
      wsHeartbeatIntervalMs: 15000,
      sshKeepaliveIntervalMs: 30000,
      // 10 min / 30s = 20 keepalives
      sshKeepaliveCountMax: 20,
    });
  });

  it("caps SSH keepalive count at 60 even for long idle timeouts", async () => {
    prismaMock.setting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => ({
      value: where.key === "runtime.sshIdleTimeoutSec" ? "7200" : "25000",
    }));

    await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({
      wsHeartbeatIntervalMs: 25000,
      sshKeepaliveIntervalMs: 30000,
      // 2 hours / 30s = 240, capped at 60
      sshKeepaliveCountMax: 60,
    });
  });

  it("defaults SSH terminal keepalive tolerance to strong idle persistence", async () => {
    prismaMock.setting.findUnique.mockResolvedValue(null);

    await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({
      wsHeartbeatIntervalMs: 25000,
      sshKeepaliveIntervalMs: 30000,
      // sshIdleTimeoutSec default = 0 → 永不 → count stays at cap (60)
      sshKeepaliveCountMax: 60,
    });
  });

  it("computes the SSH keepalive count for a 5 minute idle timeout", async () => {
    prismaMock.setting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => ({
      value: where.key === "runtime.sshIdleTimeoutSec" ? "300" : "25000",
    }));

    await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({
      sshKeepaliveCountMax: 10, // 5 min / 30s = 10 keepalives
    });
  });

  it("reads the Operation Tasks list limit from runtime settings", async () => {
    prismaMock.setting.findUnique.mockResolvedValueOnce({ value: "250" });

    await expect(getOperationTaskListLimit()).resolves.toBe(250);
    expect(() => normalizeRuntimeSettingValue("runtime.operationTaskListLimit", "9999")).toThrow(/Task center list limit/);
  });

  it("reads AI list limits from runtime settings", async () => {
    prismaMock.setting.findUnique
      .mockResolvedValueOnce({ value: "80" })
      .mockResolvedValueOnce({ value: "350" });

    await expect(getAiProviderListLimit()).resolves.toBe(80);
    await expect(getAiConversationListLimit()).resolves.toBe(350);
    expect(() => normalizeRuntimeSettingValue("runtime.aiProviderListLimit", "1")).toThrow(/AI provider list limit/);
    expect(() => normalizeRuntimeSettingValue("runtime.aiConversationListLimit", "5000")).toThrow(/AI conversation list limit/);
  });

  it("uses environment fallback when summarizing runtime values without persisted rows", () => {
    process.env.COMMAND_EXECUTION_TIMEOUT_MS = "180000";
    expect(getRuntimeSettingFallback("runtime.commandExecutionTimeoutMs")).toBe(180000);
  });

  it("summarizes current values with source and restart metadata", async () => {
    process.env.COMMAND_EXECUTION_TIMEOUT_MS = "180000";
    prismaMock.setting.findMany.mockResolvedValueOnce([
      { key: "runtime.commandReconcileIntervalMs", value: "45000" },
      { key: "runtime.sshIdleTimeoutSec", value: "9999" },
    ]);

    const summaries = await getRuntimeSettingSummaries();
    const commandTimeout = summaries.find((item) => item.key === "runtime.commandExecutionTimeoutMs");
    const reconcile = summaries.find((item) => item.key === "runtime.commandReconcileIntervalMs");
    const invalidIdle = summaries.find((item) => item.key === "runtime.sshIdleTimeoutSec");

    expect(commandTimeout).toMatchObject({ value: 180000, source: "environment", sourceLabel: "Environment variable", requiresRestart: false });
    expect(reconcile).toMatchObject({ value: 45000, source: "database", sourceLabel: "Database setting", requiresRestart: true });
    expect(invalidIdle).toMatchObject({ value: 0, source: "invalid-database", sourceLabel: "Database value invalid, fell back", requiresRestart: true });
  });
});
