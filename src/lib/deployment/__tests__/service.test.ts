vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: vi.fn(async () => async () => undefined) }));
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RoleKey } from "@/lib/auth/rbac";
import type { SessionScope } from "../service";

const { mockPrisma, mockTeamWhere, mockDeploymentRunTeamWhere, mockTeamCreateData } = vi.hoisted(() => ({
  mockPrisma: {
    commandTemplate: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), createMany: vi.fn() },
    deploymentRun: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    deploymentSnapshot: { create: vi.fn() },
    deploymentRollbackRun: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    commandRequest: { findUnique: vi.fn() },
    server: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  mockTeamWhere: vi.fn(),
  mockDeploymentRunTeamWhere: vi.fn(),
  mockTeamCreateData: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/command/service", () => ({ createCommandRequest: vi.fn(async () => ({ id: "cmd1", status: "PENDING_APPROVAL" })) }));
vi.mock("@/lib/command-template/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/command-template/service")>("@/lib/command-template/service");
  return { ...actual, seedBuiltinTemplates: vi.fn(actual.seedBuiltinTemplates) };
});
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: mockTeamWhere,
  deploymentRunTeamWhere: mockDeploymentRunTeamWhere,
  seesAllCustomers: (session: { roles?: string[]; currentTeamId?: string | null }) =>
    session.roles?.includes("admin") === true && !session.currentTeamId,
  serverTeamWhere: (session: { roles?: string[]; currentTeamId?: string | null }) => {
    if (session.roles?.includes("admin")) return {};
    return session.currentTeamId
      ? { teamId: session.currentTeamId }
      : { id: "__unassigned_servers_require_team_manage__" };
  },
  teamCreateData: mockTeamCreateData,
  isGlobalTeamManager: (session: { roles?: string[] }) => session.roles?.includes("admin") ?? false,
}));
const commandService = await import("@/lib/command/service");
const commandTemplateService = await import("@/lib/command-template/service");

const { createDeploymentRunFromTemplate, createDeploymentRollbackRun, listDeploymentRuns, listDeploymentTemplates } = await import("../service");

const teamSession: SessionScope = {
  userId: "u1",
  roles: ["operator"] as RoleKey[],
  currentTeamId: "team_a",
};
// Platform administrator viewing all customers: the unscoped view the old sessionless calls had.
const PLATFORM: SessionScope = { userId: "u1", roles: ["admin"] as RoleKey[], currentTeamId: null };

describe("deployment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTeamWhere.mockReturnValue({ teamId: "team_a" });
    mockDeploymentRunTeamWhere.mockImplementation((session: SessionScope) => (session.currentTeamId ? { teamId: session.currentTeamId } : {}));
    mockTeamCreateData.mockImplementation((session: SessionScope) => (session.currentTeamId ? { teamId: session.currentTeamId } : {}));
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));
    mockPrisma.server.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      (where.id.in ?? []).map((id: string) => ({ id })),
    );
    mockPrisma.commandTemplate.findUnique.mockResolvedValue({ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", rollbackCommand: "apt remove {{pkg}}", variables: ["pkg"] });
    mockPrisma.commandTemplate.findFirst.mockResolvedValue({ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", rollbackCommand: "apt remove {{pkg}}", variables: ["pkg"] });
    mockPrisma.commandTemplate.findMany.mockResolvedValue([{ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", rollbackCommand: "apt remove {{pkg}}", variables: ["pkg"], isBuiltin: true }]);
    mockPrisma.commandTemplate.count.mockResolvedValue(1);
    mockPrisma.commandTemplate.create.mockResolvedValue({});
    mockPrisma.deploymentRun.create.mockImplementation(async ({ data }: any) => ({ id: "dep1", ...data }));
    mockPrisma.deploymentSnapshot.create.mockImplementation(async ({ data }: any) => ({ id: "snap1", ...data }));
    mockPrisma.deploymentRun.update.mockImplementation(async ({ where, data }: any) => ({ id: where?.id ?? "dep1", ...data }));
    mockPrisma.deploymentRun.updateMany.mockImplementation(async ({ where, data }: any) => {
      void data;
      return { count: where?.id ? 1 : 0 };
    });
    mockPrisma.deploymentRollbackRun.findFirst.mockResolvedValue(null);
    mockPrisma.deploymentRollbackRun.findMany.mockResolvedValue([]);
    mockPrisma.commandRequest.findUnique.mockResolvedValue(null);
  });

  it("renders template variables and submits through command approval pipeline", async () => {
    const run = await createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: ["srv1"], variables: { pkg: "nginx" }, requesterId: "u1" }, PLATFORM);

    expect(run.commandRequestId).toBe("cmd1");
    expect(mockPrisma.deploymentRun.create.mock.calls[0]![0].data.renderedCommand).toBe("apt install nginx");
    expect(mockPrisma.deploymentRun.create.mock.calls[0]![0].data.teamId).toBeNull();
    expect(mockPrisma.deploymentSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ deployCommand: "apt install nginx", rollbackCommand: "apt remove nginx", sourceRunId: "dep1" }),
    });
    expect(commandService.createCommandRequest).toHaveBeenCalledWith(expect.objectContaining({ submissionMode: "assistant" }));
  });

  it("assigns teamId from session on create when present", async () => {
    await createDeploymentRunFromTemplate(
      { templateId: "tmpl1", serverIds: ["srv1"], variables: { pkg: "nginx" }, requesterId: "u1" },
      teamSession,
    );

    expect(mockTeamCreateData).toHaveBeenCalledWith(teamSession);
    expect(mockPrisma.deploymentRun.create.mock.calls[0]![0].data.teamId).toBe("team_a");
    expect(commandService.createCommandRequest).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team_a", submissionMode: "assistant" }),
    );
  });

  it("scopes idempotency keys by team before persisting and dispatching", async () => {
    mockPrisma.deploymentRun.findFirst.mockResolvedValue(null);

    await createDeploymentRunFromTemplate(
      {
        templateId: "tmpl1",
        serverIds: ["srv1"],
        variables: { pkg: "nginx" },
        requesterId: "u1",
        idempotencyKey: "browser-request-1",
      },
      teamSession,
    );

    expect(mockPrisma.deploymentRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: "team:team_a:browser-request-1",
      }),
    });
    expect(commandService.createCommandRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "deployment:team:team_a:browser-request-1",
      }),
    );
  });

  it("returns the existing run when the same scoped launch is replayed", async () => {
    const existing = {
      id: "dep-existing",
      commandRequestId: "cmd-existing",
      idempotencyKey: "team:team_a:browser-request-1",
    };
    mockPrisma.deploymentRun.findFirst.mockResolvedValue(existing);

    const result = await createDeploymentRunFromTemplate(
      {
        templateId: "tmpl1",
        serverIds: ["srv1"],
        variables: { pkg: "nginx" },
        requesterId: "u1",
        idempotencyKey: "browser-request-1",
      },
      teamSession,
    );

    expect(result).toBe(existing);
    expect(mockPrisma.deploymentRun.create).not.toHaveBeenCalled();
    expect(commandService.createCommandRequest).not.toHaveBeenCalled();
  });

  it("deduplicates deployment target server ids before creating run and command targets", async () => {
    const run = await createDeploymentRunFromTemplate({
      templateId: "tmpl1",
      serverIds: [" srv1 ", "srv1", "srv2", "srv2"],
      variables: { pkg: "nginx" },
      requesterId: "u1",
    }, PLATFORM);

    expect(mockPrisma.deploymentRun.create.mock.calls[0]![0]!.data.serverIds).toEqual(["srv1", "srv2"]);
    expect(commandService.createCommandRequest).toHaveBeenCalledWith(expect.objectContaining({ serverIds: ["srv1", "srv2"] }));
    expect(run.commandRequestId).toBe("cmd1");
  });

  it("rejects deployment requests without at least one target server", async () => {
    await expect(createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: [], variables: { pkg: "nginx" }, requesterId: "u1" }, PLATFORM)).rejects.toThrow("至少选择 1 台目标 VPS");
    expect(mockPrisma.deploymentRun.create).not.toHaveBeenCalled();
  });

  it("rejects missing required template variables before creating command requests", async () => {
    await expect(createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: ["srv1"], variables: {}, requesterId: "u1" }, PLATFORM)).rejects.toThrow("Deployment template variables not fully filled in: pkg");
    expect(mockPrisma.deploymentRun.create).not.toHaveBeenCalled();
  });

  it("rejects missing variables declared on the template even when they are not placeholders", async () => {
    mockPrisma.commandTemplate.findFirst.mockResolvedValueOnce({ id: "tmpl_explicit", name: "Explicit", command: "deploy static", variables: ["version"] });

    await expect(createDeploymentRunFromTemplate({ templateId: "tmpl_explicit", serverIds: ["srv1"], variables: {}, requesterId: "u1" }, PLATFORM)).rejects.toThrow("Deployment template variables not fully filled in: version");
    expect(mockPrisma.deploymentRun.create).not.toHaveBeenCalled();
  });

  it("rejects missing placeholders that appear only in rollbackCommand", async () => {
    mockPrisma.commandTemplate.findFirst.mockResolvedValueOnce({
      id: "tmpl_rb",
      name: "Rollback vars",
      command: "deploy {{pkg}}",
      rollbackCommand: "rollback {{pkg}} --tag {{tag}}",
      variables: ["pkg"],
    });

    await expect(
      createDeploymentRunFromTemplate({
        templateId: "tmpl_rb",
        serverIds: ["srv1"],
        variables: { pkg: "nginx" },
        requesterId: "u1",
      }, PLATFORM),
    ).rejects.toThrow("Deployment template variables not fully filled in: tag");
    expect(mockPrisma.deploymentRun.create).not.toHaveBeenCalled();
  });

  it("preserves deployment run failure when command request creation fails", async () => {
    vi.mocked(commandService.createCommandRequest).mockRejectedValueOnce(new Error("Approval chain not available"));

    await expect(
      createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: ["srv1"], variables: { pkg: "nginx" }, requesterId: "u1" }, PLATFORM),
    ).rejects.toThrow("Approval chain not available");

    expect(mockPrisma.deploymentRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PENDING" }),
    }));
    // No command carries the run's key: nothing was submitted, the run failed.
    expect(mockPrisma.commandRequest.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { idempotencyKey: "deployment:dep1" } }));
    expect(mockPrisma.deploymentRun.updateMany).toHaveBeenCalledWith({
      where: { id: "dep1", commandRequestId: null },
      data: expect.objectContaining({ status: "FAILED", errorMessage: "Approval chain not available" }),
    });
  });

  it("links a command whose creation committed although the call failed, instead of failing a deployment that runs", async () => {
    // The reply was lost after the insert committed: the deployment must
    // follow that command, not say FAILED while it runs.
    vi.mocked(commandService.createCommandRequest).mockRejectedValueOnce(new Error("enqueue failed"));
    mockPrisma.commandRequest.findUnique.mockResolvedValueOnce({ id: "cmd-created", status: "APPROVED" });

    await expect(
      createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: ["srv1"], variables: { pkg: "nginx" }, requesterId: "u1" }, PLATFORM),
    ).rejects.toThrow("enqueue failed");

    expect(mockPrisma.deploymentRun.updateMany).toHaveBeenCalledWith({
      where: { id: "dep1", commandRequestId: null },
      data: expect.objectContaining({ commandRequestId: "cmd-created", status: "RUNNING" }),
    });
    expect(mockPrisma.deploymentRun.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });

  it("links the command when the run's link write fails", async () => {
    // The unawaited link update escaped the catch: the run stayed PENDING and
    // unlinked while its command could be approved and run.
    mockPrisma.deploymentRun.update
      .mockImplementationOnce(async ({ where, data }: any) => ({ id: where?.id ?? "dep1", ...data }))
      .mockRejectedValueOnce(new Error("connection reset"));
    mockPrisma.commandRequest.findUnique.mockResolvedValueOnce({ id: "cmd1", status: "PENDING_APPROVAL" });

    await expect(
      createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: ["srv1"], variables: { pkg: "nginx" }, requesterId: "u1" }, PLATFORM),
    ).rejects.toThrow("connection reset");

    expect(mockPrisma.deploymentRun.updateMany).toHaveBeenCalledWith({
      where: { id: "dep1", commandRequestId: null },
      data: expect.objectContaining({ commandRequestId: "cmd1", status: "PENDING" }),
    });
  });

  it("settles a run left unlinked by an interrupted request when the runs are listed", async () => {
    const stale = { id: "dep_stale", status: "PENDING", commandRequestId: null, idempotencyKey: null, createdAt: new Date(Date.now() - 10 * 60_000), rollbackAttempts: [] };
    mockPrisma.deploymentRun.findMany
      .mockResolvedValueOnce([stale])
      .mockResolvedValueOnce([{ ...stale, commandRequestId: "cmd_stale", commandRequest: { status: "PENDING_APPROVAL" } }]);
    mockPrisma.commandRequest.findUnique.mockResolvedValueOnce({ id: "cmd_stale", status: "PENDING_APPROVAL" });

    const runs = await listDeploymentRuns(PLATFORM);

    expect(mockPrisma.commandRequest.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { idempotencyKey: "deployment:dep_stale" } }));
    expect(mockPrisma.deploymentRun.updateMany).toHaveBeenCalledWith({
      where: { id: "dep_stale", commandRequestId: null },
      data: expect.objectContaining({ commandRequestId: "cmd_stale" }),
    });
    expect(runs[0]).toMatchObject({ id: "dep_stale", commandRequestId: "cmd_stale" });
  });

  it("leaves a fresh unlinked run alone (its request may still be creating the command)", async () => {
    mockPrisma.deploymentRun.findMany.mockResolvedValueOnce([
      { id: "dep_new", status: "PENDING", commandRequestId: null, idempotencyKey: null, createdAt: new Date(), rollbackAttempts: [] },
    ]);
    await listDeploymentRuns(PLATFORM);
    expect(mockPrisma.commandRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.deploymentRun.findMany).toHaveBeenCalledTimes(1);
  });

  it("propagates source DeploymentRun.teamId onto rollback CommandRequest", async () => {
    mockPrisma.deploymentRun.findFirst.mockResolvedValue({
      id: "dep1",
      teamId: "team_a",
      template: { id: "tmpl1", name: "Nginx" },
      snapshot: {
        id: "snap1",
        templateName: "Nginx",
        rollbackCommand: "apt remove nginx",
        serverIds: ["srv1"],
      },
    });
    mockPrisma.deploymentRollbackRun.create.mockImplementation(async ({ data }: any) => ({ id: "rb1", ...data }));
    mockPrisma.deploymentRollbackRun.update.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));

    const rollback = await createDeploymentRollbackRun(
      { sourceRunId: "dep1", requesterId: "u1", reason: "bad deploy" },
      teamSession,
    );

    expect(commandService.createCommandRequest).toHaveBeenCalledWith(expect.objectContaining({
      title: "Rollback deployment: Nginx",
      command: "apt remove nginx",
      reason: "bad deploy",
      serverIds: ["srv1"],
      submissionMode: "assistant",
      teamId: "team_a",
    }));
    expect(rollback).toMatchObject({ id: "rb1", commandRequestId: "cmd1", status: "PENDING" });
  });

  it("creates a real rollback run from the immutable deployment snapshot", async () => {
    mockPrisma.deploymentRun.findFirst.mockResolvedValue({
      id: "dep1",
      teamId: null,
      template: { id: "tmpl1", name: "Nginx" },
      snapshot: {
        id: "snap1",
        templateName: "Nginx",
        rollbackCommand: "apt remove nginx",
        serverIds: ["srv1"],
      },
    });
    mockPrisma.deploymentRollbackRun.create.mockImplementation(async ({ data }: any) => ({ id: "rb1", ...data }));
    mockPrisma.deploymentRollbackRun.update.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));

    const rollback = await createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1", reason: "bad deploy" }, PLATFORM);

    expect(commandService.createCommandRequest).toHaveBeenCalledWith(expect.objectContaining({
      title: "Rollback deployment: Nginx",
      command: "apt remove nginx",
      reason: "bad deploy",
      serverIds: ["srv1"],
      submissionMode: "assistant",
      teamId: null,
    }));
    expect(rollback).toMatchObject({ id: "rb1", commandRequestId: "cmd1", status: "PENDING" });
  });

  it("blocks duplicate active rollback attempts for the same deployment run", async () => {
    mockPrisma.deploymentRun.findFirst.mockResolvedValue({
      id: "dep1",
      template: { id: "tmpl1", name: "Nginx" },
      snapshot: {
        id: "snap1",
        templateName: "Nginx",
        rollbackCommand: "apt remove nginx",
        serverIds: ["srv1"],
      },
    });
    mockPrisma.deploymentRollbackRun.findMany.mockResolvedValueOnce([{ id: "rb_active", status: "PENDING", commandRequestId: "cmd_active" }]);

    await expect(createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1" }, PLATFORM)).rejects.toThrow(/rollback|回滚/i);
    expect(mockPrisma.deploymentRollbackRun.create).not.toHaveBeenCalled();
    expect(commandService.createCommandRequest).not.toHaveBeenCalled();
  });

  it.each(["COMPLETED", "FAILED", "REJECTED"])("allows a new rollback once the previous one's command is %s, without a list read first", async (commandStatus) => {
    // The previous rollback stayed PENDING until listDeploymentRuns synced it,
    // so retrying right after it ended answered 409 until a page reload.
    mockPrisma.deploymentRun.findFirst.mockResolvedValue({
      id: "dep1",
      template: { id: "tmpl1", name: "Nginx" },
      snapshot: { id: "snap1", templateName: "Nginx", rollbackCommand: "apt remove nginx", serverIds: ["srv1"] },
    });
    mockPrisma.deploymentRollbackRun.findMany.mockResolvedValueOnce([
      { id: "rb_old", status: "PENDING", errorMessage: null, completedAt: null, commandRequestId: "cmd_old", commandRequest: { status: commandStatus } },
    ]);
    mockPrisma.deploymentRollbackRun.create.mockResolvedValueOnce({ id: "rb_new", status: "PENDING", commandRequestId: null });

    await createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1" }, PLATFORM).catch(() => undefined);

    expect(mockPrisma.deploymentRollbackRun.create).toHaveBeenCalled();
    expect(mockPrisma.deploymentRollbackRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "rb_old" },
      data: expect.objectContaining({ status: commandStatus }),
    }));
  });

  describe("rollback crash and bookkeeping windows (stateful store)", () => {
    type Row = { id: string; sourceRunId: string; status: string; commandRequestId: string | null; errorMessage?: string | null };
    let rollbacks: Map<string, Row>;
    let commands: Map<string, { id: string; status: string; idempotencyKey: string }>;
    let failLinkUpdate: boolean;
    let failRecoveryLookup: boolean;

    beforeEach(() => {
      rollbacks = new Map();
      commands = new Map();
      failLinkUpdate = false;
      failRecoveryLookup = false;
      mockPrisma.deploymentRun.findFirst.mockResolvedValue({
        id: "dep1",
        teamId: null,
        template: { id: "tmpl1", name: "Nginx" },
        snapshot: { id: "snap1", templateName: "Nginx", rollbackCommand: "apt remove nginx", serverIds: ["srv1"] },
      });
      mockPrisma.deploymentRollbackRun.findMany.mockImplementation(async ({ where }: any) =>
        [...rollbacks.values()].filter((row) => row.sourceRunId === where.sourceRunId && where.status.in.includes(row.status)));
      // findFirst mirrors findMany so the pre-fix single-row lookup sees the same store.
      mockPrisma.deploymentRollbackRun.findFirst.mockImplementation(async ({ where }: any) =>
        [...rollbacks.values()].find((row) => row.sourceRunId === where.sourceRunId && where.status.in.includes(row.status)) ?? null);
      mockPrisma.deploymentRollbackRun.create.mockImplementation(async ({ data }: any) => {
        const row = { id: `rb${rollbacks.size + 1}`, sourceRunId: data.sourceRunId, status: data.status, commandRequestId: null };
        rollbacks.set(row.id, row);
        return row;
      });
      mockPrisma.deploymentRollbackRun.update.mockImplementation(async ({ where, data }: any) => {
        if (failLinkUpdate && data.commandRequestId) throw new Error("link write failed");
        const row = rollbacks.get(where.id)!;
        Object.assign(row, data);
        return { ...row };
      });
      mockPrisma.commandRequest.findUnique.mockImplementation(async ({ where }: any) => {
        if (failRecoveryLookup) throw new Error("process killed (injected)");
        return [...commands.values()].find((command) => command.idempotencyKey === where.idempotencyKey) ?? null;
      });
      vi.mocked(commandService.createCommandRequest).mockImplementation((async (input: any) => {
        const command = { id: `cmd${commands.size + 1}`, status: "PENDING_APPROVAL", idempotencyKey: input.idempotencyKey };
        commands.set(command.id, command);
        return command;
      }) as never);
    });

    it("a rollback interrupted before its command was created does not block the next rollback forever", async () => {
      vi.mocked(commandService.createCommandRequest).mockRejectedValueOnce(new Error("process killed (injected)"));
      failRecoveryLookup = true; // a killed process runs no compensation
      await expect(createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1" }, PLATFORM)).rejects.toThrow("process killed");
      expect(rollbacks.get("rb1")).toMatchObject({ status: "PENDING", commandRequestId: null });

      failRecoveryLookup = false;
      const next = await createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1" }, PLATFORM);

      expect(next).toMatchObject({ id: "rb2", commandRequestId: "cmd1" });
      expect(rollbacks.get("rb1")).toMatchObject({ status: "FAILED" });
      expect(commands.size).toBe(1);
    });

    it("a command created but not linked is linked, never marked FAILED, and never submitted twice", async () => {
      failLinkUpdate = true;
      await expect(createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1" }, PLATFORM)).rejects.toThrow("link write failed");
      failLinkUpdate = false;
      // The failure path itself must not retire a rollback whose command exists.
      expect(rollbacks.get("rb1")!.status).not.toBe("FAILED");

      await expect(createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1" }, PLATFORM)).rejects.toThrow(/rollback|回滚/i);
      expect(rollbacks.get("rb1")).toMatchObject({ status: "PENDING", commandRequestId: "cmd1" });
      expect(commands.size).toBe(1);
    });

    it("a process killed between command creation and the link is recovered by the next request", async () => {
      failLinkUpdate = true;
      failRecoveryLookup = true;
      await expect(createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1" }, PLATFORM)).rejects.toThrow("link write failed");
      failLinkUpdate = false;
      failRecoveryLookup = false;
      expect(rollbacks.get("rb1")).toMatchObject({ status: "PENDING", commandRequestId: null });

      await expect(createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1" }, PLATFORM)).rejects.toThrow(/rollback|回滚/i);
      expect(rollbacks.get("rb1")).toMatchObject({ commandRequestId: "cmd1", status: "PENDING" });
      expect(commands.size).toBe(1);
    });

    it("an unlinked rollback whose command already finished is closed and lets a new rollback start", async () => {
      rollbacks.set("rb_old", { id: "rb_old", sourceRunId: "dep1", status: "PENDING", commandRequestId: null });
      commands.set("cmd_old", { id: "cmd_old", status: "COMPLETED", idempotencyKey: "deployment-rollback:rb_old" });

      const next = await createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1" }, PLATFORM);

      expect(rollbacks.get("rb_old")).toMatchObject({ status: "COMPLETED", commandRequestId: "cmd_old" });
      expect(next).toMatchObject({ commandRequestId: "cmd2" });
    });
  });

  it("rejects rollback when source run is outside team scope", async () => {
    mockPrisma.deploymentRun.findFirst.mockResolvedValue(null);

    await expect(
      createDeploymentRollbackRun({ sourceRunId: "foreign_dep", requesterId: "u1" }, teamSession),
    ).rejects.toMatchObject({ name: "NotFoundError" });

    expect(mockDeploymentRunTeamWhere).toHaveBeenCalledWith(teamSession);
    expect(mockPrisma.deploymentRun.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign_dep", teamId: "team_a" },
      include: { snapshot: true, template: true },
    });
    expect(mockPrisma.deploymentRollbackRun.create).not.toHaveBeenCalled();
  });

  it("refuses rollback when a snapshot target has left the caller's team", async () => {
    // The snapshot froze raw server ids at launch; if one has since moved
    // workspaces, replaying it must not become a way to command that VPS.
    mockPrisma.deploymentRun.findFirst.mockResolvedValue({
      id: "dep1",
      teamId: "team_a",
      template: { id: "tmpl1", name: "Nginx" },
      snapshot: {
        id: "snap1",
        templateName: "Nginx",
        rollbackCommand: "apt remove nginx",
        serverIds: ["srv1", "srv_moved"],
      },
    });
    mockPrisma.server.findMany.mockResolvedValueOnce([{ id: "srv1" }]);

    await expect(
      createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1" }, teamSession),
    ).rejects.toMatchObject({ name: "ValidationError" });

    expect(mockPrisma.deploymentRollbackRun.create).not.toHaveBeenCalled();
    expect(commandService.createCommandRequest).not.toHaveBeenCalled();
  });

  it("lists templates for the deployment page without rendering secrets", async () => {
    const templates = await listDeploymentTemplates(PLATFORM);
    expect(templates).toEqual([{ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", rollbackCommand: "apt remove {{pkg}}", variables: ["pkg"], isBuiltin: true }]);
    expect(commandTemplateService.seedBuiltinTemplates).toHaveBeenCalled();
    expect(mockPrisma.commandTemplate.findMany).toHaveBeenCalledWith({ orderBy: [{ isBuiltin: "desc" }, { name: "asc" }], take: 200 });
  });

  it("scopes list queries strictly to the caller's team", async () => {
    // Strict, not loose: a run holds the rendered command, the rollback snapshot
    // and its target server ids, so a null-team legacy row stays quarantined
    // instead of being listed (and rolled back) by every tenant.
    mockPrisma.deploymentRun.findMany.mockResolvedValue([]);

    await listDeploymentRuns(teamSession);

    expect(mockDeploymentRunTeamWhere).toHaveBeenCalledWith(teamSession);
    expect(mockPrisma.deploymentRun.findMany).toHaveBeenCalledWith({
      where: { teamId: "team_a" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      include: expect.objectContaining({ template: true }),
    });
  });

  it("supports server-side deployment history pages", async () => {
    mockPrisma.deploymentRun.findMany.mockResolvedValue([]);

    await listDeploymentRuns(teamSession, { skip: 20, take: 21 });

    expect(mockPrisma.deploymentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 21 }),
    );
  });

  it("marks deployment run as rejected when its approval request is rejected", async () => {
    mockPrisma.deploymentRun.findMany.mockResolvedValue([
      {
        id: "dep_rejected",
        templateId: "tmpl1",
        commandRequestId: "cmd_rejected",
        status: "PENDING",
        variables: {},
        renderedCommand: "systemctl restart nginx",
        serverIds: ["srv1"],
        createdBy: "u1",
        createdAt: new Date("2026-05-25T00:00:00Z"),
        updatedAt: new Date("2026-05-25T00:01:00Z"),
        completedAt: null,
        errorMessage: null,
        template: { id: "tmpl1", name: "Nginx" },
        creator: { username: "admin", displayName: "Admin" },
        commandRequest: { status: "REJECTED" },
      },
    ]);

    const runs = await listDeploymentRuns(PLATFORM);

    expect(runs[0]).toMatchObject({
      id: "dep_rejected",
      status: "REJECTED",
      errorMessage: "Associated command request has been rejected; deployment will not execute.",
    });
    expect(mockPrisma.deploymentRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
    }));
  });

  it("persists terminal deployment status derived from the linked command request", async () => {
    const createdAt = new Date("2026-05-25T00:00:00Z");
    const updatedAt = new Date("2026-05-25T00:01:00Z");
    mockPrisma.deploymentRun.findMany.mockResolvedValue([
      {
        id: "dep_failed",
        templateId: "tmpl1",
        commandRequestId: "cmd_failed",
        status: "RUNNING",
        variables: {},
        renderedCommand: "systemctl restart nginx",
        serverIds: ["srv1", "srv2"],
        createdBy: "u1",
        createdAt,
        updatedAt,
        completedAt: null,
        errorMessage: null,
        template: { id: "tmpl1", name: "Nginx" },
        creator: { username: "admin", displayName: "Admin" },
        commandRequest: { status: "FAILED" },
      },
    ]);
    mockPrisma.deploymentRun.update.mockImplementationOnce(async ({ data }: any) => ({
      id: "dep_failed",
      templateId: "tmpl1",
      commandRequestId: "cmd_failed",
      variables: {},
      renderedCommand: "systemctl restart nginx",
      serverIds: ["srv1", "srv2"],
      createdBy: "u1",
      createdAt,
      updatedAt,
      completedAt: data.completedAt,
      template: { id: "tmpl1", name: "Nginx" },
      creator: { username: "admin", displayName: "Admin" },
      commandRequest: { status: "FAILED" },
      ...data,
    }));

    const runs = await listDeploymentRuns(PLATFORM);

    expect(mockPrisma.deploymentRun.update).toHaveBeenCalledWith({
      where: { id: "dep_failed" },
      data: {
        status: "FAILED",
        errorMessage: "Associated command request has failed.",
        completedAt: expect.any(Date),
      },
      include: expect.objectContaining({
        template: true,
        creator: { select: { username: true, displayName: true } },
        commandRequest: { select: { status: true } },
      }),
    });
    expect(runs[0]).toMatchObject({
      id: "dep_failed",
      status: "FAILED",
      errorMessage: "Associated command request has failed.",
    });
    expect(runs[0]!.completedAt).toBeInstanceOf(Date);
  });

  it("returns a resolved rollback status on the same list refresh that persists it", async () => {
    const rollback = {
      id: "rollback_completed",
      status: "PENDING",
      errorMessage: null,
      completedAt: null,
      commandRequest: { status: "COMPLETED" },
    };
    mockPrisma.deploymentRun.findMany.mockResolvedValueOnce([
      {
        id: "dep_with_rollback",
        status: "COMPLETED",
        errorMessage: null,
        completedAt: new Date("2026-05-25T00:01:00Z"),
        commandRequest: { status: "COMPLETED" },
        rollbackAttempts: [rollback],
      },
    ]);
    mockPrisma.deploymentRollbackRun.update.mockResolvedValueOnce({
      ...rollback,
      status: "COMPLETED",
      completedAt: new Date("2026-05-25T00:02:00Z"),
    });

    const runs = await listDeploymentRuns(PLATFORM);

    expect(mockPrisma.deploymentRollbackRun.update).toHaveBeenCalledWith({
      where: { id: "rollback_completed" },
      data: {
        status: "COMPLETED",
        errorMessage: null,
        completedAt: expect.any(Date),
      },
    });
    expect(runs[0]?.rollbackAttempts[0]).toMatchObject({
      id: "rollback_completed",
      status: "COMPLETED",
    });
  });

  it("rejects serverIds outside team scope on create", async () => {
    mockPrisma.server.findMany.mockResolvedValueOnce([{ id: "srv1" }]);
    await expect(
      createDeploymentRunFromTemplate(
        { templateId: "tmpl1", serverIds: ["srv1", "srv_other"], variables: { pkg: "nginx" }, requesterId: "u1" },
        teamSession,
      ),
    ).rejects.toThrow(/outside your customer scope/);
    expect(mockPrisma.deploymentRun.create).not.toHaveBeenCalled();
  });
});
