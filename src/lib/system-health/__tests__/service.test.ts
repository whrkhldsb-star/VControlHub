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

  it("scopes inventory counts to the caller's team for non-admins", async () => {
    await collectSystemHealthChecks({
      projectRoot: process.cwd(),
      session: { userId: "u1", roles: ["viewer"], currentTeamId: "team-x" },
    });

    // A team viewer must not see the platform-wide totals — serverTeamWhere
    // pins servers to their team, teamWhere lets storage include shared (null).
    expect(mockPrisma.server.count).toHaveBeenCalledWith({ where: { teamId: "team-x" } });
    expect(mockPrisma.storageNode.count).toHaveBeenCalledWith({
      where: { OR: [{ teamId: "team-x" }, { teamId: null }] },
    });
  });

  it("counts the full fleet for global managers", async () => {
    await collectSystemHealthChecks({
      projectRoot: process.cwd(),
      session: { userId: "admin", roles: ["admin"], currentTeamId: null },
    });

    expect(mockPrisma.server.count).toHaveBeenCalledWith({ where: {} });
    expect(mockPrisma.storageNode.count).toHaveBeenCalledWith({ where: {} });
  });

  it("hides platform-internal checks (services, env, git, notifications) from non-manager health:read users", async () => {
    const result = await collectSystemHealthChecks({
      projectRoot: process.cwd(),
      session: { userId: "u1", roles: ["viewer"], currentTeamId: "team-x" },
    });

    const ids = result.checks.map((check) => check.id);
    // Tenant-relevant reassurance checks remain visible…
    expect(ids).toContain("database");
    expect(ids).toContain("server-inventory");
    expect(ids).toContain("runtime-directories");
    // …but control-plane fingerprinting is withheld.
    expect(ids).not.toContain("git-sync");
    expect(ids).not.toContain("env-database-url");
    expect(ids).not.toContain("next-service");
    expect(ids).not.toContain("notification-settings");
    // No systemctl / git probing is even attempted for a plain viewer.
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("exposes platform-internal checks to global managers", async () => {
    const result = await collectSystemHealthChecks({
      projectRoot: process.cwd(),
      session: { userId: "admin", roles: ["admin"], currentTeamId: null },
    });

    const ids = result.checks.map((check) => check.id);
    expect(ids).toContain("git-sync");
    expect(ids).toContain("env-database-url");
    expect(ids).toContain("next-service");
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
      if (file === "systemctl" && args.join(" ") === "is-active vcontrolhub-worker.service") return "active\n";
      if (file === "systemctl" && args.join(" ") === "is-active vcontrolhub-ssh-ws.service") return "active\n";
      if (file === "systemctl" && args.join(" ") === "is-active whrkhldsb-next.service") return "inactive\n";
      if (file === "systemctl" && args.join(" ") === "is-active whrkhldsb-ssh-ws.service") return "inactive\n";
      if (file === "git" && args.includes("rev-parse")) return "abc123\n";
      if (file === "git" && args.includes("ls-remote")) return "abc123456789\trefs/heads/main\n";
      return "";
    });

    const result = await collectSystemHealthChecks({ projectRoot: process.cwd() });

    expect(mockExecFileSync).toHaveBeenCalledWith("systemctl", ["is-active", "vcontrolhub-next.service"], expect.any(Object));
    expect(mockExecFileSync).toHaveBeenCalledWith("systemctl", ["is-active", "vcontrolhub-worker.service"], expect.any(Object));
    expect(mockExecFileSync).toHaveBeenCalledWith("systemctl", ["is-active", "vcontrolhub-ssh-ws.service"], expect.any(Object));
    expect(mockExecFileSync).not.toHaveBeenCalledWith("systemctl", ["is-active", "whrkhldsb-next.service"], expect.any(Object));
    expect(result.checks.find((check) => check.id === "next-service")).toMatchObject({
      status: "healthy",
      message: expect.stringContaining("vcontrolhub-next.service"),
    });
    expect(result.checks.find((check) => check.id === "worker-service")).toMatchObject({
      status: "healthy",
      message: expect.stringContaining("vcontrolhub-worker.service"),
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
