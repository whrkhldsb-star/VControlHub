import { describe, expect, it, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    createDeploymentRunFromTemplate: vi.fn(),
    listDeploymentRuns: vi.fn(),
    listDeploymentTemplates: vi.fn(),
    auditUserAction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/deployment/service", () => ({
  createDeploymentRunFromTemplate: mocks.createDeploymentRunFromTemplate,
  listDeploymentRuns: mocks.listDeploymentRuns,
  listDeploymentTemplates: mocks.listDeploymentTemplates,
}));
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.auditUserAction,
}));

const route = await import("../route");

describe("/api/deployments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({
      session: { userId: "u1", roles: ["operator"], currentTeamId: null, user: { id: "u1" } },
    });
    mocks.listDeploymentRuns.mockResolvedValue([{ id: "dep1" }]);
    mocks.listDeploymentTemplates.mockResolvedValue([{ id: "tmpl1" }]);
    mocks.createDeploymentRunFromTemplate.mockResolvedValue({ id: "dep1" });
  });

  it("returns deployments and templates for deploy page bootstrap", async () => {
    const res = await route.GET(new Request("http://local/api/deployments"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      deployments: [{ id: "dep1" }],
      templates: [{ id: "tmpl1" }],
    });
    expect(mocks.listDeploymentRuns).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1" }),
    );
  });

  it("rejects deployment creation without target servers", async () => {
    const req = new Request("http://local/api/deployments", {
      method: "POST",
      body: JSON.stringify({
        templateId: "tmpl1",
        serverIds: [],
        variables: {},
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
    expect(mocks.createDeploymentRunFromTemplate).not.toHaveBeenCalled();
  });

  it("rejects malformed deployment JSON with the shared bodySchema error envelope", async () => {
    const req = new Request("http://local/api/deployments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });

    const res = await route.POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Request body is not valid JSON" });
    expect(mocks.createDeploymentRunFromTemplate).not.toHaveBeenCalled();
    expect(mocks.auditUserAction).not.toHaveBeenCalled();
  });

  it("passes normalized deployment input to the service", async () => {
    const req = new Request("http://local/api/deployments", {
      method: "POST",
      body: JSON.stringify({
        templateId: "tmpl1",
        serverIds: ["srv1"],
        variables: { version: "v1" },
        reason: "  upgrade  ",
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    expect(mocks.createDeploymentRunFromTemplate).toHaveBeenCalledWith({
      templateId: "tmpl1",
      serverIds: ["srv1"],
      variables: { version: "v1" },
      requesterId: "u1",
      reason: "upgrade",
    }, expect.objectContaining({ userId: "u1" }));
  });
  it("accepts browser form submissions and redirects back to deployments page", async () => {
    const req = new Request("http://local/api/deployments", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams([
        ["templateId", "tmpl1"],
        ["serverIds", "srv1"],
        ["serverIds", "srv2"],
        ["variables.version", "v2.1.0"],
        ["variables.service", "api"],
        ["reason", " deploy "],
      ]),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://local/deployments");
    expect(mocks.createDeploymentRunFromTemplate).toHaveBeenCalledWith({
      templateId: "tmpl1",
      serverIds: ["srv1", "srv2"],
      variables: { version: "v2.1.0", service: "api" },
      requesterId: "u1",
      reason: "deploy",
    }, expect.objectContaining({ userId: "u1" }));
  });

  it("returns a deployment error page for browser form failures instead of raw JSON", async () => {
    mocks.createDeploymentRunFromTemplate.mockRejectedValueOnce(
      new Error("模板变量 version 缺失"),
    );
    const req = new Request("http://local/api/deployments", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams([
        ["templateId", "tmpl1"],
        ["serverIds", "srv1"],
        ["reason", "deploy"],
      ]),
    });

    const res = await route.POST(req);

    const location = res.headers.get("location");
    expect(location).toContain("http://local/deployments?error=");
    expect(new URL(location ?? "").searchParams.get("error")).toBe(
      "模板变量 version 缺失",
    );
  });

  it("audits successful deployment creation", async () => {
    const req = new Request("http://local/api/deployments", {
      method: "POST",
      body: JSON.stringify({
        templateId: "tmpl1",
        serverIds: ["srv1"],
        variables: { version: "v1" },
        reason: "upgrade",
      }),
    });

    const res = await route.POST(req);

    expect(res.status).toBe(201);
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "deployment.create",
      {
        deploymentId: "dep1",
        templateId: "tmpl1",
        serverIds: ["srv1"],
        reason: "upgrade",
      },
    );
  });
});
