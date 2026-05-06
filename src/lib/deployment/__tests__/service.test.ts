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

const { createDeploymentRunFromTemplate, listDeploymentTemplates } = await import("../service");

describe("deployment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.commandTemplate.findUnique.mockResolvedValue({ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", variables: ["pkg"] });
    mockPrisma.commandTemplate.findMany.mockResolvedValue([{ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", variables: ["pkg"], isActive: true }]);
    mockPrisma.deploymentRun.create.mockImplementation(async ({ data }: any) => ({ id: "dep1", ...data }));
    mockPrisma.deploymentRun.update.mockImplementation(async ({ data }: any) => ({ id: "dep1", ...data }));
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

  it("lists templates for the deployment page without rendering secrets", async () => {
    const templates = await listDeploymentTemplates();
    expect(templates).toEqual([{ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", variables: ["pkg"], isActive: true }]);
    expect(mockPrisma.commandTemplate.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" } });
  });
});
