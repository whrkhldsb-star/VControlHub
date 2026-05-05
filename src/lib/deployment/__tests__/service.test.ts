import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    commandTemplate: { findUnique: vi.fn() },
    deploymentRun: { create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/command/service", () => ({ createCommandRequest: vi.fn(async () => ({ id: "cmd1", status: "PENDING_APPROVAL" })) }));

const { createDeploymentRunFromTemplate } = await import("../service");

describe("deployment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.commandTemplate.findUnique.mockResolvedValue({ id: "tmpl1", name: "Nginx", command: "apt install {{pkg}}", variables: ["pkg"] });
    mockPrisma.deploymentRun.create.mockImplementation(async ({ data }: any) => ({ id: "dep1", ...data }));
    mockPrisma.deploymentRun.update.mockImplementation(async ({ data }: any) => ({ id: "dep1", ...data }));
  });

  it("renders template variables and submits through command approval pipeline", async () => {
    const run = await createDeploymentRunFromTemplate({ templateId: "tmpl1", serverIds: ["srv1"], variables: { pkg: "nginx" }, requesterId: "u1" });

    expect(run.commandRequestId).toBe("cmd1");
    expect(mockPrisma.deploymentRun.create.mock.calls[0][0].data.renderedCommand).toBe("apt install nginx");
  });
});
