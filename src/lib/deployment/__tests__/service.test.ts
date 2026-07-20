import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RoleKey } from "@/lib/auth/rbac";
import type { SessionScope } from "../service";

const { mockPrisma, mockTeamWhere, mockTeamCreateData } = vi.hoisted(() => ({
  mockPrisma: {
    commandTemplate: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    deploymentRun: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    deploymentSnapshot: { create: vi.fn() },
    deploymentRollbackRun: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    server: { findMany: vi.fn() },
  },
  mockTeamWhere: vi.fn(),
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
  teamCreateData: mockTeamCreateData,
}));
const commandService = await import("@/lib/command/service");
const commandTemplateService = await import("@/lib/command-template/service");

const { createDeploymentRunFromTemplate, createDeploymentRollbackRun, listDeploymentRuns, listDeploymentTemplates } = await import("../service");

const teamSession: SessionScope = {
  userId: "u1",
  roles: ["operator"] as RoleKey[],
  currentTeamId: "team_a",
};

describe("deployment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTeamWhere.mockReturnValue({ OR: [{ teamId: "team_a" }, { teamId: null }] });
    mockTeamCreateData.mockReturnValue({ teamId: "team_a" });
    mockPrisma.server.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      (where.id.in ?? []).map((id: string) => ({ id })),
    );
    mockPrisma.commandTemplate.findUnique.mockResolvedValue({ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", rollbackCommand: "apt remove {{pkg}}", variables: ["pkg"] });
    mockPrisma.commandTemplate.findMany.mockResolvedValue([{ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", rollbackCommand: "apt remove {{pkg}}", variables: ["pkg"], isActive: true }]);
    mockPrisma.commandTemplate.count.mockResolvedValue(1);
    mockPrisma.commandTemplate.create.mockResolvedValue({});
    mockPrisma.deploymentRun.create.mockImplementation(async ({ data }: any) => ({ id: "dep1", ...data }));
    mockPrisma.deploymentSnapshot.create.mockImplementation(async ({ data }: any) => ({ id: "snap1", ...data }));
    mockPrisma.deploymentRun.update.mockImplementation(async ({ where, data }: any) => ({ id: where?.id ?? "dep1", ...data }));
    mockPrisma.deploymentRollbackRun.findFirst.mockResolvedValue(null);
  });

  it("renders template variables and submits through command approval pipeline", async () => {
    const run = await createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: ["srv1"], variables: { pkg: "nginx" }, requesterId: "u1" });

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

  it("deduplicates deployment target server ids before creating run and command targets", async () => {
    const run = await createDeploymentRunFromTemplate({
      templateId: "tmpl1",
      serverIds: [" srv1 ", "srv1", "srv2", "srv2"],
      variables: { pkg: "nginx" },
      requesterId: "u1",
    });

    expect(mockPrisma.deploymentRun.create.mock.calls[0]![0]!.data.serverIds).toEqual(["srv1", "srv2"]);
    expect(commandService.createCommandRequest).toHaveBeenCalledWith(expect.objectContaining({ serverIds: ["srv1", "srv2"] }));
    expect(run.commandRequestId).toBe("cmd1");
  });

  it("rejects deployment requests without at least one target server", async () => {
    await expect(createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: [], variables: { pkg: "nginx" }, requesterId: "u1" })).rejects.toThrow("至少选择 1 台目标 VPS");
    expect(mockPrisma.deploymentRun.create).not.toHaveBeenCalled();
  });

  it("rejects missing required template variables before creating command requests", async () => {
    await expect(createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: ["srv1"], variables: {}, requesterId: "u1" })).rejects.toThrow("Deployment template variables not fully filled in: pkg");
    expect(mockPrisma.deploymentRun.create).not.toHaveBeenCalled();
  });

  it("rejects missing variables declared on the template even when they are not placeholders", async () => {
    mockPrisma.commandTemplate.findUnique.mockResolvedValueOnce({ id: "tmpl_explicit", name: "Explicit", command: "deploy static", variables: ["version"] });

    await expect(createDeploymentRunFromTemplate({ templateId: "tmpl_explicit", serverIds: ["srv1"], variables: {}, requesterId: "u1" })).rejects.toThrow("Deployment template variables not fully filled in: version");
    expect(mockPrisma.deploymentRun.create).not.toHaveBeenCalled();
  });

  it("preserves deployment run failure when command request creation fails", async () => {
    vi.mocked(commandService.createCommandRequest).mockRejectedValueOnce(new Error("Approval chain not available"));

    await expect(
      createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: ["srv1"], variables: { pkg: "nginx" }, requesterId: "u1" }),
    ).rejects.toThrow("Approval chain not available");

    expect(mockPrisma.deploymentRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PENDING" }),
    }));
    expect(mockPrisma.deploymentRun.update).toHaveBeenCalledWith({
      where: { id: "dep1" },
      data: { status: "FAILED", errorMessage: "Approval chain not available" },
    });
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

    const rollback = await createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1", reason: "bad deploy" });

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
    mockPrisma.deploymentRollbackRun.findFirst.mockResolvedValueOnce({ id: "rb_active", status: "PENDING" });

    await expect(createDeploymentRollbackRun({ sourceRunId: "dep1", requesterId: "u1" })).rejects.toThrow("A rollback task is already in progress; please wait for the current rollback to complete before retrying");
    expect(mockPrisma.deploymentRollbackRun.create).not.toHaveBeenCalled();
    expect(commandService.createCommandRequest).not.toHaveBeenCalled();
  });

  it("rejects rollback when source run is outside team scope", async () => {
    mockPrisma.deploymentRun.findFirst.mockResolvedValue(null);

    await expect(
      createDeploymentRollbackRun({ sourceRunId: "foreign_dep", requesterId: "u1" }, teamSession),
    ).rejects.toMatchObject({ name: "NotFoundError" });

    expect(mockTeamWhere).toHaveBeenCalledWith(teamSession);
    expect(mockPrisma.deploymentRun.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign_dep", OR: [{ teamId: "team_a" }, { teamId: null }] },
      include: { snapshot: true, template: true },
    });
    expect(mockPrisma.deploymentRollbackRun.create).not.toHaveBeenCalled();
  });

  it("lists templates for the deployment page without rendering secrets", async () => {
    const templates = await listDeploymentTemplates();
    expect(templates).toEqual([{ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", rollbackCommand: "apt remove {{pkg}}", variables: ["pkg"], isActive: true }]);
    expect(commandTemplateService.seedBuiltinTemplates).toHaveBeenCalled();
    expect(mockPrisma.commandTemplate.findMany).toHaveBeenCalledWith({ orderBy: [{ isBuiltin: "desc" }, { name: "asc" }], take: 200 });
  });

  it("scopes list queries with teamWhere when session is provided", async () => {
    mockPrisma.deploymentRun.findMany.mockResolvedValue([]);

    await listDeploymentRuns(teamSession);

    expect(mockTeamWhere).toHaveBeenCalledWith(teamSession);
    expect(mockPrisma.deploymentRun.findMany).toHaveBeenCalledWith({
      where: { OR: [{ teamId: "team_a" }, { teamId: null }] },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: expect.objectContaining({ template: true }),
    });
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

    const runs = await listDeploymentRuns();

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

    const runs = await listDeploymentRuns();

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

  it("rejects serverIds outside team scope on create", async () => {
    mockPrisma.server.findMany.mockResolvedValueOnce([{ id: "srv1" }]);
    await expect(
      createDeploymentRunFromTemplate(
        { templateId: "tmpl1", serverIds: ["srv1", "srv_other"], variables: { pkg: "nginx" }, requesterId: "u1" },
        teamSession,
      ),
    ).rejects.toThrow(/outside your team scope/);
    expect(mockPrisma.deploymentRun.create).not.toHaveBeenCalled();
  });
});
