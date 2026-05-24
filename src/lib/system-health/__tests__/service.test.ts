import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma, mockExecSync } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRaw: vi.fn(),
    server: { count: vi.fn() },
    storageNode: { count: vi.fn() },
    setting: { findMany: vi.fn() },
  },
  mockExecSync: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
  default: { execSync: mockExecSync },
}));

const { collectSystemHealthChecks, summarizeSystemHealth } = await import("../service");

describe("system health service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPrisma.server.count.mockResolvedValue(2);
    mockPrisma.storageNode.count.mockResolvedValue(1);
    mockPrisma.setting.findMany.mockResolvedValue([]);
    mockExecSync.mockImplementation((command: string) => {
      if (command.includes("rev-parse --short HEAD")) return "abc123\n";
      if (command.includes("ls-remote origin refs/heads/main")) return "abc123\n";
      return "";
    });
  });

  it("collects portable deployment and runtime checks without exposing secrets", async () => {
    const result = await collectSystemHealthChecks({ projectRoot: process.cwd() });

    expect(result.checks.length).toBeGreaterThan(4);
    expect(result.checks.some((check) => check.id === "database")).toBe(true);
    expect(result.checks.some((check) => check.id === "runtime-directories")).toBe(true);
    expect(result.checks.some((check) => check.id === "git-sync")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/postgres:\/\/[^\s]+:[^\s]+@/i);
  });

  it("summarizes warning and critical checks", () => {
    expect(summarizeSystemHealth([
      { id: "ok", label: "OK", status: "healthy", message: "ok" },
      { id: "warn", label: "Warn", status: "warning", message: "warn" },
      { id: "bad", label: "Bad", status: "critical", message: "bad" },
    ])).toMatchObject({ total: 3, healthy: 1, warning: 1, critical: 1, overall: "critical" });
  });

  it("marks git sync as warning when origin/main differs from local head", async () => {
    mockExecSync.mockImplementation((command: string) => {
      if (command.includes("rev-parse --short HEAD")) return "abc123\n";
      if (command.includes("ls-remote origin refs/heads/main")) return "def456\n";
      return "";
    });

    const result = await collectSystemHealthChecks({ projectRoot: process.cwd() });
    const gitSync = result.checks.find((check) => check.id === "git-sync");

    expect(gitSync?.status).toBe("warning");
    expect(gitSync?.message).toContain("不一致");
  });
});
