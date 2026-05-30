import { describe, expect, it, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    buildPortableDeploymentPackage: vi.fn(),
    createDeploymentExport: vi.fn(),
  },
}));

vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: vi.fn(async (_request, _options, handler) => handler({ session: { userId: "u1" } })),
}));
vi.mock("@/lib/deploy-export/service", () => ({
  buildPortableDeploymentPackage: mocks.buildPortableDeploymentPackage,
  createDeploymentExport: mocks.createDeploymentExport,
}));

const route = await import("../route");

describe("/api/deploy-export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildPortableDeploymentPackage.mockReturnValue({ manifest: { domain: "console.example.test" }, files: {} });
    mocks.createDeploymentExport.mockResolvedValue({ id: "exp1", name: "vcontrolhub-portable", manifest: { domain: "console.example.test" }, files: {} });
  });

  it("builds a preview package with the deploy:export permission guard", async () => {
    const res = await route.GET(new Request("http://local/api/deploy-export?domain=console.example.test"));

    expect(res.status).toBe(200);
    expect(mocks.buildPortableDeploymentPackage).toHaveBeenCalledWith({ domain: "console.example.test" });
    await expect(res.json()).resolves.toEqual({ manifest: { domain: "console.example.test" }, files: {} });
  });

  it("creates portable exports from the current UI payload without legacy format/services fields", async () => {
    const req = new Request("http://local/api/deploy-export", {
      method: "POST",
      body: JSON.stringify({ domain: " console.example.test ", appName: " vcontrolhub " }),
    });

    const res = await route.POST(req);

    expect(res.status).toBe(201);
    expect(mocks.createDeploymentExport).toHaveBeenCalledWith({
      userId: "u1",
      domain: "console.example.test",
      appName: "vcontrolhub",
    });
    await expect(res.json()).resolves.toEqual({
      export: { id: "exp1", name: "vcontrolhub-portable", manifest: { domain: "console.example.test" }, files: {} },
    });
  });

  it("still rejects invalid legacy format values", async () => {
    const req = new Request("http://local/api/deploy-export", {
      method: "POST",
      body: JSON.stringify({ domain: "console.example.test", format: "zip" }),
    });

    const res = await route.POST(req);

    expect(res.status).toBe(400);
    expect(mocks.createDeploymentExport).not.toHaveBeenCalled();
  });
});
