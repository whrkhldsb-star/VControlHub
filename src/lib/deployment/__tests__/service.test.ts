import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    commandTemplate: { findUnique: vi.fn(), findMany: vi.fn() },
    deploymentRun: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/command/service", () => ({ createCommandRequest: vi.fn(async () => ({ id: "cmd1", status: "PENDING_APPROVAL" })) }));
const commandService = await import("@/lib/command/service");

const { createDeploymentRunFromTemplate, listDeploymentRuns, listDeploymentTemplates } = await import("../service");

describe("deployment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.commandTemplate.findUnique.mockResolvedValue({ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", variables: ["pkg"] });
    mockPrisma.commandTemplate.findMany.mockResolvedValue([{ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", variables: ["pkg"], isActive: true }]);
    mockPrisma.deploymentRun.create.mockImplementation(async ({ data }: any) => ({ id: "dep1", ...data }));
    mockPrisma.deploymentRun.update.mockImplementation(async ({ where, data }: any) => ({ id: where?.id ?? "dep1", ...data }));
  });

  it("renders template variables and submits through command approval pipeline", async () => {
    const run = await createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: ["srv1"], variables: { pkg: "nginx" }, requesterId: "u1" });

    expect(run.commandRequestId).toBe("cmd1");
    expect(mockPrisma.deploymentRun.create.mock.calls[0][0].data.renderedCommand).toBe("apt install nginx");
    expect(commandService.createCommandRequest).toHaveBeenCalledWith(expect.objectContaining({ submissionMode: "assistant" }));
  });

  it("rejects deployment requests without at least one target server", async () => {
    await expect(createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: [], variables: { pkg: "nginx" }, requesterId: "u1" })).rejects.toThrow("至少选择 1 台目标 VPS");
    expect(mockPrisma.deploymentRun.create).not.toHaveBeenCalled();
  });

  it("rejects missing required template variables before creating command requests", async () => {
    await expect(createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: ["srv1"], variables: {}, requesterId: "u1" })).rejects.toThrow("部署模板变量未填写完整");
    expect(mockPrisma.deploymentRun.create).not.toHaveBeenCalled();
  });

  it("preserves deployment run failure when command request creation fails", async () => {
    vi.mocked(commandService.createCommandRequest).mockRejectedValueOnce(new Error("审批链路不可用"));

    await expect(
      createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: ["srv1"], variables: { pkg: "nginx" }, requesterId: "u1" }),
    ).rejects.toThrow("审批链路不可用");

    expect(mockPrisma.deploymentRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PENDING" }),
    }));
    expect(mockPrisma.deploymentRun.update).toHaveBeenCalledWith({
      where: { id: "dep1" },
      data: { status: "FAILED", errorMessage: "审批链路不可用" },
    });
  });

  it("lists templates for the deployment page without rendering secrets", async () => {
    const templates = await listDeploymentTemplates();
    expect(templates).toEqual([{ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", variables: ["pkg"], isActive: true }]);
    expect(mockPrisma.commandTemplate.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" } });
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
      errorMessage: "关联命令请求已被拒绝，部署不会执行。",
    });
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
        errorMessage: "关联命令请求已失败。",
        completedAt: expect.any(Date),
      },
      include: {
        template: true,
        creator: { select: { username: true, displayName: true } },
        commandRequest: { select: { status: true } },
      },
    });
    expect(runs[0]).toMatchObject({
      id: "dep_failed",
      status: "FAILED",
      errorMessage: "关联命令请求已失败。",
    });
    expect(runs[0].completedAt).toBeInstanceOf(Date);
  });
});
