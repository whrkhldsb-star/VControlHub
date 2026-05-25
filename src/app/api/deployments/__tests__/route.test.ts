import { describe, expect, it, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireSession: vi.fn(),
    sessionHasPermission: vi.fn(),
    createDeploymentRunFromTemplate: vi.fn(),
    listDeploymentRuns: vi.fn(),
    listDeploymentTemplates: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: mocks.sessionHasPermission }));
vi.mock("@/lib/deployment/service", () => ({
  createDeploymentRunFromTemplate: mocks.createDeploymentRunFromTemplate,
  listDeploymentRuns: mocks.listDeploymentRuns,
  listDeploymentTemplates: mocks.listDeploymentTemplates,
}));

const route = await import("../route");

describe("/api/deployments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ userId: "u1", user: { id: "u1" } });
    mocks.sessionHasPermission.mockReturnValue(true);
    mocks.listDeploymentRuns.mockResolvedValue([{ id: "dep1" }]);
    mocks.listDeploymentTemplates.mockResolvedValue([{ id: "tmpl1" }]);
    mocks.createDeploymentRunFromTemplate.mockResolvedValue({ id: "dep1" });
  });

  it("returns deployments and templates for deploy page bootstrap", async () => {
    const res = await route.GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deployments: [{ id: "dep1" }], templates: [{ id: "tmpl1" }] });
  });

  it("rejects deployment creation without target servers", async () => {
    const req = new Request("http://local/api/deployments", { method: "POST", body: JSON.stringify({ templateId: "tmpl1", serverIds: [], variables: {} }) });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
    expect(mocks.createDeploymentRunFromTemplate).not.toHaveBeenCalled();
  });

  it("passes normalized deployment input to the service", async () => {
    const req = new Request("http://local/api/deployments", { method: "POST", body: JSON.stringify({ templateId: "tmpl1", serverIds: ["srv1"], variables: { version: "v1" }, reason: "  upgrade  " }) });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    expect(mocks.createDeploymentRunFromTemplate).toHaveBeenCalledWith({ templateId: "tmpl1", serverIds: ["srv1"], variables: { version: "v1" }, requesterId: "u1", reason: "upgrade" });
  });
  it("accepts browser form submissions and redirects back to deployments page", async () => {
    const req = new Request("http://local/api/deployments", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      body: new URLSearchParams([
        ["templateId", "tmpl1"],
        ["serverIds", "srv1"],
        ["serverIds", "srv2"],
        ["reason", " deploy "],
      ]),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://local/deployments");
    expect(mocks.createDeploymentRunFromTemplate).toHaveBeenCalledWith({ templateId: "tmpl1", serverIds: ["srv1", "srv2"], variables: {}, requesterId: "u1", reason: "deploy" });
  });

  it("returns a deployment error page for browser form failures instead of raw JSON", async () => {
    mocks.createDeploymentRunFromTemplate.mockRejectedValueOnce(new Error("模板变量 version 缺失"));
    const req = new Request("http://local/api/deployments", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      body: new URLSearchParams([
        ["templateId", "tmpl1"],
        ["serverIds", "srv1"],
        ["reason", "deploy"],
      ]),
    });

    const res = await route.POST(req);

    const location = res.headers.get("location");
    expect(location).toContain("http://local/deployments?error=");
    expect(new URL(location ?? "").searchParams.get("error")).toBe("模板变量 version 缺失");
  });

});
