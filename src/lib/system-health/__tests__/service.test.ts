import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma, mockExecFileSync } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRaw: vi.fn(),
    server: { count: vi.fn() },
    storageNode: { count: vi.fn() },
    setting: { findMany: vi.fn() },
  },
  mockExecFileSync: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
  default: { execFileSync: mockExecFileSync },
}));

const { collectSystemHealthChecks, summarizeSystemHealth } = await import("../service");

describe("system health service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPrisma.server.count.mockResolvedValue(2);
    mockPrisma.storageNode.count.mockResolvedValue(1);
    mockPrisma.setting.findMany.mockResolvedValue([]);
    mockExecFileSync.mockImplementation((file: string, args: string[]) => {
      if (file === "git" && args.includes("rev-parse")) return "abc123\n";
      if (file === "git" && args.includes("ls-remote")) return "abc123456789\trefs/heads/main\n";
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

  it("checks the production VControlHub service units instead of legacy whrkhldsb units", async () => {
    mockExecFileSync.mockImplementation((file: string, args: string[]) => {
      if (file === "systemctl" && args.join(" ") === "is-active vcontrolhub-next.service") return "active\n";
      if (file === "systemctl" && args.join(" ") === "is-active vcontrolhub-ssh-ws.service") return "active\n";
      if (file === "systemctl" && args.join(" ") === "is-active whrkhldsb-next.service") return "inactive\n";
      if (file === "systemctl" && args.join(" ") === "is-active whrkhldsb-ssh-ws.service") return "inactive\n";
      if (file === "git" && args.includes("rev-parse")) return "abc123\n";
      if (file === "git" && args.includes("ls-remote")) return "abc123456789\trefs/heads/main\n";
      return "";
    });

    const result = await collectSystemHealthChecks({ projectRoot: process.cwd() });

    expect(mockExecFileSync).toHaveBeenCalledWith("systemctl", ["is-active", "vcontrolhub-next.service"], expect.any(Object));
    expect(mockExecFileSync).toHaveBeenCalledWith("systemctl", ["is-active", "vcontrolhub-ssh-ws.service"], expect.any(Object));
    expect(mockExecFileSync).not.toHaveBeenCalledWith("systemctl", ["is-active", "whrkhldsb-next.service"], expect.any(Object));
    expect(result.checks.find((check) => check.id === "next-service")).toMatchObject({
      status: "healthy",
      message: expect.stringContaining("vcontrolhub-next.service"),
    });
    expect(result.checks.find((check) => check.id === "ssh-ws-service")).toMatchObject({
      status: "healthy",
      message: expect.stringContaining("vcontrolhub-ssh-ws.service"),
    });
  });

  it("marks git sync as warning when origin/main differs from local head", async () => {
    mockExecFileSync.mockImplementation((file: string, args: string[]) => {
      if (file === "git" && args.includes("rev-parse")) return "abc123\n";
      if (file === "git" && args.includes("ls-remote")) return "def456789012\trefs/heads/main\n";
      return "";
    });

    const result = await collectSystemHealthChecks({ projectRoot: process.cwd() });
    const gitSync = result.checks.find((check) => check.id === "git-sync");

    expect(gitSync?.status).toBe("warning");
    expect(gitSync?.message).toContain("Local abc123 does not match origin/main def4567");
  });
});
