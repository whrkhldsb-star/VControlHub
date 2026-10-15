import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

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
  RUNTIME_SETTING_DEFINITIONS,
} = await import("./service");

describe("runtime settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COMMAND_EXECUTION_TIMEOUT_MS;
    // getRuntimeSettingNumbers reads persisted rows via findMany; default to
    // "no rows" so each test's findUnique/findMany mocks decide the values.
    prismaMock.setting.findMany.mockResolvedValue([]);
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
    prismaMock.setting.findMany.mockResolvedValue([
      { key: "runtime.commandExecutionTimeoutMs", value: "60000" },
      { key: "runtime.commandStaleRunningAfterMs", value: "30000" },
    ]);

    await expect(getCommandRuntimeConfig()).resolves.toMatchObject({
      executionTimeoutMs: 60000,
      staleRunningAfterMs: 30000,
    });
  });

  it("reads the whole command runtime config in a single query", async () => {
    prismaMock.setting.findMany.mockResolvedValueOnce([
      { key: "runtime.commandExecutionTimeoutMs", value: "60000" },
      { key: "runtime.commandStaleRunningAfterMs", value: "30000" },
    ]);

    await expect(getCommandRuntimeConfig()).resolves.toMatchObject({
      executionTimeoutMs: 60000,
      staleRunningAfterMs: 30000,
    });
    expect(prismaMock.setting.findMany).toHaveBeenCalledOnce();
    expect(prismaMock.setting.findUnique).not.toHaveBeenCalled();
    // Keys absent from the batch fall back instead of throwing.
    expect(prismaMock.setting.findMany.mock.calls[0]?.[0]?.where?.key?.in).toHaveLength(4);
  });

  it("rejects out-of-range runtime values", () => {
    expect(() => normalizeRuntimeSettingValue("runtime.commandExecutionTimeoutMs", "1")).toThrow(/must be between/);
  });

  /** Serve the same rows to the batch (findMany) and single-key (findUnique) reads. */
  function mockSettingRows(rows: Record<string, string>) {
    prismaMock.setting.findMany.mockImplementation(async ({ where }: { where: { key: { in: string[] } } }) =>
      where.key.in.filter((key) => key in rows).map((key) => ({ key, value: rows[key] })));
    prismaMock.setting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      (where.key in rows ? { value: rows[where.key] } : null));
  }

  describe("SSH terminal keepalive", () => {
    beforeEach(() => {
      delete process.env.SSH_KEEPALIVE_INTERVAL_MS;
      delete process.env.SSH_KEEPALIVE_COUNT_MAX;
      mockSettingRows({});
    });

    afterEach(() => {
      delete process.env.SSH_KEEPALIVE_INTERVAL_MS;
      delete process.env.SSH_KEEPALIVE_COUNT_MAX;
    });

    it("reads keepalive settings from persisted runtime settings", async () => {
      mockSettingRows({
        "runtime.sshWsHeartbeatIntervalMs": "15000",
        "runtime.sshKeepaliveIntervalMs": "30000",
        "runtime.sshIdleTimeoutSec": "600",
      });

      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({
        wsHeartbeatIntervalMs: 15000,
        sshKeepaliveIntervalMs: 30000,
        // 10 min / 30s = 20 keepalives
        sshKeepaliveCountMax: 20,
      });
    });

    it("caps the derived count at 60 even for long idle timeouts", async () => {
      mockSettingRows({ "runtime.sshIdleTimeoutSec": "7200" });

      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({
        wsHeartbeatIntervalMs: 25000,
        sshKeepaliveIntervalMs: 30000,
        // 2 hours / 30s = 240, capped at 60
        sshKeepaliveCountMax: 60,
      });
    });

    it("defaults to strong idle persistence", async () => {
      await expect(getSshTerminalRuntimeConfig()).resolves.toEqual({
        wsHeartbeatIntervalMs: 25000,
        sshKeepaliveIntervalMs: 30000,
        // sshIdleTimeoutSec default = 0 → 永不 → count stays at cap (60)
        sshKeepaliveCountMax: 60,
        sshIdleTimeoutMs: 0,
      });
    });

    it("derives the count for a 5 minute idle timeout", async () => {
      mockSettingRows({ "runtime.sshIdleTimeoutSec": "300" });

      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({
        sshKeepaliveCountMax: 10, // 5 min / 30s = 10 keepalives
      });
    });

    it("derives the count from a persisted keepalive interval", async () => {
      mockSettingRows({ "runtime.sshKeepaliveIntervalMs": "10000", "runtime.sshIdleTimeoutSec": "300" });

      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({
        sshKeepaliveIntervalMs: 10000,
        // 5 min / 10s = 30
        sshKeepaliveCountMax: 30,
      });
    });

    it("uses SSH_KEEPALIVE_INTERVAL_MS when no interval row exists", async () => {
      process.env.SSH_KEEPALIVE_INTERVAL_MS = "20000";
      mockSettingRows({ "runtime.sshIdleTimeoutSec": "300" });

      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({
        sshKeepaliveIntervalMs: 20000,
        sshKeepaliveCountMax: 15, // 5 min / 20s
      });
    });

    it("lets a persisted count override the derived one", async () => {
      mockSettingRows({ "runtime.sshKeepaliveCountMax": "3", "runtime.sshIdleTimeoutSec": "300" });

      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({ sshKeepaliveCountMax: 3 });
    });

    it("keeps an explicit persisted 60 even when the idle timeout would derive less", async () => {
      mockSettingRows({ "runtime.sshKeepaliveCountMax": "60", "runtime.sshIdleTimeoutSec": "300" });

      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({ sshKeepaliveCountMax: 60 });
    });

    it("accepts the lower bound 1 for a persisted count", async () => {
      mockSettingRows({ "runtime.sshKeepaliveCountMax": "1", "runtime.sshIdleTimeoutSec": "0" });
      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({ sshKeepaliveCountMax: 1 });
    });

    it("uses SSH_KEEPALIVE_COUNT_MAX when no count row exists", async () => {
      process.env.SSH_KEEPALIVE_COUNT_MAX = "4";
      mockSettingRows({ "runtime.sshIdleTimeoutSec": "300" });

      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({ sshKeepaliveCountMax: 4 });
    });

    it("prefers the persisted count over SSH_KEEPALIVE_COUNT_MAX", async () => {
      process.env.SSH_KEEPALIVE_COUNT_MAX = "4";
      mockSettingRows({ "runtime.sshKeepaliveCountMax": "7", "runtime.sshIdleTimeoutSec": "300" });

      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({ sshKeepaliveCountMax: 7 });
    });

    it("clamps SSH_KEEPALIVE_COUNT_MAX to the setting range", async () => {
      process.env.SSH_KEEPALIVE_COUNT_MAX = "500";
      mockSettingRows({ "runtime.sshIdleTimeoutSec": "300" });

      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({ sshKeepaliveCountMax: 60 });
    });

    it("ignores an unusable SSH_KEEPALIVE_COUNT_MAX and keeps the derived count", async () => {
      mockSettingRows({ "runtime.sshIdleTimeoutSec": "300" });
      for (const value of ["0", "-3", "abc", " "]) {
        process.env.SSH_KEEPALIVE_COUNT_MAX = value;
        await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({ sshKeepaliveCountMax: 10 });
      }
    });

    it("treats an invalid persisted count as absent: env first, otherwise derived", async () => {
      // Config import can store values the settings API would reject.
      mockSettingRows({ "runtime.sshKeepaliveCountMax": "0", "runtime.sshIdleTimeoutSec": "300" });
      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({ sshKeepaliveCountMax: 10 });

      mockSettingRows({ "runtime.sshKeepaliveCountMax": "nope", "runtime.sshIdleTimeoutSec": "300" });
      process.env.SSH_KEEPALIVE_COUNT_MAX = "5";
      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({ sshKeepaliveCountMax: 5 });
    });

    it("falls back to env, then the derived count, when the database read fails", async () => {
      prismaMock.setting.findMany.mockRejectedValue(new Error("db down"));
      prismaMock.setting.findUnique.mockRejectedValue(new Error("db down"));
      process.env.SSH_KEEPALIVE_INTERVAL_MS = "15000";

      // Nothing persisted is readable: idle timeout default 0 → cap 60.
      await expect(getSshTerminalRuntimeConfig()).resolves.toEqual({
        wsHeartbeatIntervalMs: 25000,
        sshKeepaliveIntervalMs: 15000,
        sshKeepaliveCountMax: 60,
        sshIdleTimeoutMs: 0,
      });

      process.env.SSH_KEEPALIVE_COUNT_MAX = "6";
      await expect(getSshTerminalRuntimeConfig()).resolves.toMatchObject({ sshKeepaliveCountMax: 6 });
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

  it("truncates and clamps an env override the same way a persisted value is", () => {
    // A fractional value used to reach a Prisma `take`, and an out-of-range one
    // bypassed the bound the settings UI enforces.
    process.env.AI_PROVIDER_LIST_LIMIT = "50.5";
    expect(getRuntimeSettingFallback("runtime.aiProviderListLimit")).toBe(50);
    process.env.AI_PROVIDER_LIST_LIMIT = "99999";
    expect(getRuntimeSettingFallback("runtime.aiProviderListLimit")).toBe(500);
    process.env.AI_PROVIDER_LIST_LIMIT = "1";
    expect(getRuntimeSettingFallback("runtime.aiProviderListLimit")).toBe(10);
    delete process.env.AI_PROVIDER_LIST_LIMIT;
    expect(getRuntimeSettingFallback("runtime.aiProviderListLimit")).toBe(100);
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
    // sshIdleTimeoutSec now applies per terminal connection (no restart).
    expect(invalidIdle).toMatchObject({ value: 0, source: "invalid-database", sourceLabel: "Database value invalid, fell back", requiresRestart: false });
  });

  it("accepts an env value of 0 only for keys whose minimum is 0", () => {
    process.env.AUDIT_RETENTION_DAYS = "0";
    expect(getRuntimeSettingFallback("retention.auditLogDays")).toBe(0);
    delete process.env.AUDIT_RETENTION_DAYS;
    process.env.AI_PROVIDER_LIST_LIMIT = "0";
    expect(getRuntimeSettingFallback("runtime.aiProviderListLimit")).toBe(100);
    delete process.env.AI_PROVIDER_LIST_LIMIT;
  });

  it("keeps every definition's default inside its own range", () => {
    for (const [key, definition] of Object.entries(RUNTIME_SETTING_DEFINITIONS)) {
      expect(definition.defaultValue, key).toBeGreaterThanOrEqual(definition.min);
      expect(definition.defaultValue, key).toBeLessThanOrEqual(definition.max);
      expect(normalizeRuntimeSettingValue(key as keyof typeof RUNTIME_SETTING_DEFINITIONS, definition.defaultValue)).toBe(String(definition.defaultValue));
    }
  });
});
