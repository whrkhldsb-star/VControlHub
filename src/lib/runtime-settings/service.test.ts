import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    setting: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const {
  getRuntimeSettingNumber,
  getCommandRuntimeConfig,
  getSshTerminalRuntimeConfig,
  getOperationTaskListLimit,
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
    expect(() => normalizeRuntimeSettingValue("runtime.commandExecutionTimeoutMs", "1")).toThrow(/必须在/);
  });

  it("reads SSH terminal keepalive settings from persisted runtime settings", async () => {
    prismaMock.setting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => ({
      value: where.key === "runtime.sshKeepaliveCountMax" ? "12" : "15000",
    }));

    await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({
      wsHeartbeatIntervalMs: 15000,
      sshKeepaliveIntervalMs: 15000,
      sshKeepaliveCountMax: 12,
    });
  });

  it("reads the Operation Tasks list limit from runtime settings", async () => {
    prismaMock.setting.findUnique.mockResolvedValueOnce({ value: "250" });

    await expect(getOperationTaskListLimit()).resolves.toBe(250);
    expect(() => normalizeRuntimeSettingValue("runtime.operationTaskListLimit", "9999")).toThrow(/任务中心列表上限/);
  });
});
