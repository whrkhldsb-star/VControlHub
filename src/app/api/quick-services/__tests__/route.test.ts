import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    listQuickServices: vi.fn(),
    installService: vi.fn(),
    checkPort: vi.fn(),
    getUsedPorts: vi.fn(),
    allocatePort: vi.fn(),
    startService: vi.fn(),
    stopService: vi.fn(),
    uninstallService: vi.fn(),
    syncServiceStatus: vi.fn(),
    updateService: vi.fn(),
    getDockerEnvironmentStatus: vi.fn(),
    getRemoteApps: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/quick-service/catalog", () => ({
  SERVICE_CATALOG: [{ slug: "alist", name: "AList", category: "storage", icon: "box", description: "files", image: "alist:latest", defaultPort: 5244, path: "/" }],
}));
vi.mock("@/lib/quick-service/service", () => ({
  listQuickServices: mocks.listQuickServices,
  installService: mocks.installService,
  checkPort: mocks.checkPort,
  getUsedPorts: mocks.getUsedPorts,
  allocatePort: mocks.allocatePort,
  startService: mocks.startService,
  stopService: mocks.stopService,
  uninstallService: mocks.uninstallService,
  syncServiceStatus: mocks.syncServiceStatus,
  updateService: mocks.updateService,
  getDockerEnvironmentStatus: mocks.getDockerEnvironmentStatus,
}));
vi.mock("@/lib/quick-service/app-source-sync", () => ({
  getRemoteApps: mocks.getRemoteApps,
  normalizedAppToTemplate: (app: { slug: string; name: string; defaultPort: number }) => ({
    slug: app.slug,
    name: app.name,
    category: "remote",
    image: "remote:latest",
    defaultPort: app.defaultPort,
  }),
}));

const rootRoute = await import("../route");
const slugRoute = await import("../[slug]/route");
const checkPortRoute = await import("../check-port/route");

async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("/api/quick-services routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1", username: "alice", roles: ["admin"] } });
    mocks.listQuickServices.mockResolvedValue([]);
    mocks.installService.mockResolvedValue({ id: "svc1", slug: "alist", status: "installing", port: 5244 });
    mocks.checkPort.mockReturnValue({ available: true });
    mocks.getUsedPorts.mockReturnValue([{ port: 3000, usedBy: "vcontrolhub" }]);
    mocks.getDockerEnvironmentStatus.mockReturnValue({ available: true, running: true, version: "Docker 26", message: null, installHint: null });
    mocks.allocatePort.mockReturnValue(5244);
    mocks.startService.mockResolvedValue(undefined);
    mocks.stopService.mockResolvedValue(undefined);
    mocks.uninstallService.mockResolvedValue(undefined);
    mocks.syncServiceStatus.mockResolvedValue("running");
    mocks.updateService.mockResolvedValue({ status: "running", health: "healthy", logTail: "ready" });
    mocks.getRemoteApps.mockResolvedValue([]);
  });

  it("uses docker:manage rather than broad user management for Quick Services access", async () => {
    const response = await rootRoute.GET(new Request("http://local/api/quick-services"));

    expect(response.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("docker:manage");
    expect(mocks.requireApiPermission).not.toHaveBeenCalledWith("user:manage");
  });

  it("short-circuits when the user lacks Quick Services manage permission", async () => {
    mocks.requireApiPermission.mockResolvedValueOnce(Response.json({ error: "权限不足" }, { status: 403 }));

    const response = await rootRoute.GET(new Request("http://local/api/quick-services"));

    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({ error: "权限不足" });
    expect(mocks.listQuickServices).not.toHaveBeenCalled();
  });

  it("lists local and remote catalog entries with installed status", async () => {
    mocks.listQuickServices.mockResolvedValueOnce([{ id: "svc1", slug: "alist", status: "running", containerId: "c1", port: 5244, error: null }]);
    mocks.getRemoteApps.mockResolvedValueOnce([{ slug: "jellyfin", name: "Jellyfin", category: "media", icon: "tv", description: "media", image: "jellyfin", defaultPort: 8096, path: "/", sourceName: "LinuxServer", stars: 10, monthlyPulls: 20 }]);

    const response = await rootRoute.GET(new Request("http://local/api/quick-services"));
    const json = await body(response);

    expect(response.status).toBe(200);
    expect(json.catalog).toEqual([expect.objectContaining({ slug: "alist", status: "running", id: "svc1", source: "local" })]);
    expect(json.remoteCatalog).toEqual([expect.objectContaining({ slug: "jellyfin", source: "LinuxServer", monthlyPulls: 20 })]);
    expect(json.usedPorts).toEqual([{ port: 3000, usedBy: "vcontrolhub" }]);
  });

  it("installs a local service for the authorized user", async () => {
    const response = await rootRoute.POST(new Request("http://local/api/quick-services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alist", customPort: 5244 }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.installService).toHaveBeenCalledWith({
      template: expect.objectContaining({ slug: "alist", initialPassword: expect.any(String) }),
      userId: "u1",
      customPort: 5244,
      installNoticeCredentials: [
        { label: "账号", value: "admin" },
        { label: "初始密码", value: expect.any(String) },
      ],
      installNoticeNotes: ["AList 初始管理员密码已在容器启动后自动设置。"],
    });
    const json = await body(response) as { notice: { credentials: Array<{ label: string; value: string }> } };
    expect(json.notice.credentials).toEqual([
      { label: "账号", value: "admin" },
      { label: "初始密码", value: expect.any(String) },
    ]);
  });

  it("returns 409 when a requested custom port is already used", async () => {
    mocks.checkPort.mockReturnValueOnce({ available: false, usedBy: "AList" });

    const response = await rootRoute.POST(new Request("http://local/api/quick-services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alist", customPort: 5244 }),
    }));

    expect(response.status).toBe(409);
    expect(await body(response)).toEqual({ error: "端口 5244 已被占用（AList），请更换端口后重试", portConflict: true, usedBy: "AList" });
    expect(mocks.installService).not.toHaveBeenCalled();
  });

  it("maps install-time port conflicts to 409", async () => {
    mocks.installService.mockRejectedValueOnce(new Error("端口 5244 已被占用"));

    const response = await rootRoute.POST(new Request("http://local/api/quick-services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alist" }),
    }));

    expect(response.status).toBe(409);
    expect(await body(response)).toEqual({ error: "端口 5244 已被占用", portConflict: true });
  });

  it("runs slug actions through the guarded route", async () => {
    const response = await slugRoute.PATCH(new Request("http://local/api/quick-services/alist", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "sync" }),
    }), { params: Promise.resolve({ slug: "alist" }) });

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ success: true, status: "running" });
    expect(mocks.syncServiceStatus).toHaveBeenCalledWith("alist");
  });

  it("updates a service through the guarded slug route", async () => {
    const response = await slugRoute.PATCH(new Request("http://local/api/quick-services/alist", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update" }),
    }), { params: Promise.resolve({ slug: "alist" }) });

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ success: true, status: "running", health: "healthy", logTail: "ready", updated: true });
    expect(mocks.updateService).toHaveBeenCalledWith("alist");
  });

  it("uninstalls services through the guarded route", async () => {
    const response = await slugRoute.DELETE(new Request("http://local/api/quick-services/alist", { method: "DELETE" }), { params: Promise.resolve({ slug: "alist" }) });

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ success: true });
    expect(mocks.uninstallService).toHaveBeenCalledWith("alist");
  });

  it("checks and allocates ports", async () => {
    const checkResponse = await checkPortRoute.GET(new Request("http://local/api/quick-services/check-port?port=5244"));
    const allocateResponse = await checkPortRoute.GET(new Request("http://local/api/quick-services/check-port?action=allocate&preferred=5244"));

    expect(checkResponse.status).toBe(200);
    expect(await body(checkResponse)).toEqual({ port: 5244, available: true });
    expect(allocateResponse.status).toBe(200);
    expect(await body(allocateResponse)).toEqual({ port: 5244, available: true });
    expect(mocks.allocatePort).toHaveBeenCalledWith(5244);
  });
});
