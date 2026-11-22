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
      session: { userId: "u1", roles: ["operator"], permissions: ["deploy:read"], currentTeamId: null, user: { id: "u1" } },
    });
    const template = { id: "tmpl1", createdById: "another-user", command: "template command", rollbackCommand: "undo" };
    mocks.listDeploymentRuns.mockResolvedValue([{ id: "dep1", createdBy: "another-user", renderedCommand: "deploy",
      variables: { argument: "private" }, template, snapshot: { createdBy: "another-user", deployCommand: "deploy", rollbackCommand: "undo", variables: { argument: "private" } },
      rollbackAttempts: [{ createdBy: "another-user", rollbackCommand: "undo" }] }]);
    mocks.listDeploymentTemplates.mockResolvedValue([template]);
    mocks.createDeploymentRunFromTemplate.mockResolvedValue({ id: "dep1" });
  });

  it("returns deployment metadata and redacts other authors’ commands and snapshot arguments", async () => {
    const res = await route.GET(new Request("http://local/api/deployments"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      deployments: [{ id: "dep1", renderedCommand: "", variables: {}, template: { command: "", rollbackCommand: null },
        snapshot: { deployCommand: "", rollbackCommand: null, variables: {} }, rollbackAttempts: [{ rollbackCommand: "" }] }],
      templates: [{ id: "tmpl1", command: "", rollbackCommand: null }],
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

  it("forwards the Idempotency-Key header to the deployment service", async () => {
    const res = await route.POST(new Request("http://local/api/deployments", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "deploy-request-1" },
      body: JSON.stringify({ templateId: "tmpl1", serverIds: ["srv1"], variables: {} }),
    }));
    expect(res.status).toBe(201);
    expect(mocks.createDeploymentRunFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "deploy-request-1" }),
      expect.objectContaining({ userId: "u1" }),
    );
  });

  it("rejects an oversized header even when the JSON body contains a valid key", async () => {
    const response = await route.POST(new Request("http://local/api/deployments", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "k".repeat(301) },
      body: JSON.stringify({ templateId: "tmpl1", serverIds: ["srv1"], idempotencyKey: "body-key" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.createDeploymentRunFromTemplate).not.toHaveBeenCalled();
  });
  it("accepts browser form submissions and redirects back to deployments page", async () => {
    const req = new Request("http://local/api/deployments", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        // Browser form posts always declare a length; without it the route
        // answers 411 before parsing (see requestContentLengthMissing).
        "content-length": "1024",
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
    expect(res.headers.get("location")).toBe("http://local/deployments?success=1");
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
        "content-length": "1024",
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
    undefined, null);
  });
});
