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
    enqueueQuickServiceJob: vi.fn(),
    getDockerEnvironmentStatus: vi.fn(),
    getRemoteApps: vi.fn(),
    serverFindMany: vi.fn(async () => [] as Array<{ id: string; name: string; host: string }>),
    serverFindUnique: vi.fn(async () => ({ id: "srv1", enabled: true, name: "vps-1" })),
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
}));
vi.mock("@/lib/quick-service/docker-cli", () => ({
  HUB_HOST_INSTANCE_KEY: "hub-host",
  getDockerEnvironmentStatusFor: vi.fn(async () => ({ available: true, running: true, version: "Docker", message: null, installHint: null, scope: "hub-host" })),
  getDockerEnvironmentStatus: mocks.getDockerEnvironmentStatus,
  dockerExecSync: vi.fn(),
  dockerErrorMessage: vi.fn(),
  getContainerHealth: vi.fn(),
  getContainerLogTail: vi.fn(),
}));
vi.mock("@/lib/quick-service/job-worker", () => ({
  enqueueQuickServiceJob: mocks.enqueueQuickServiceJob,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    server: {
      findMany: mocks.serverFindMany,
      findUnique: mocks.serverFindUnique,
    },
  },
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
    mocks.requireApiPermission.mockResolvedValue({
      session: { userId: "u1", username: "alice", roles: ["admin"], mustChangePassword: false, currentTeamId: null },
    });
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
    mocks.enqueueQuickServiceJob.mockResolvedValue({ job: { id: "job_qs_1", status: "PENDING" }, taskId: "job:job_qs_1", reused: false });
    mocks.getRemoteApps.mockResolvedValue([]);
    mocks.serverFindMany.mockResolvedValue([]);
  });

  it("uses docker:manage rather than broad user management for Quick Services access", async () => {
    const response = await rootRoute.GET(new Request("http://local/api/quick-services"));

    expect(response.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("docker:manage");
    expect(mocks.requireApiPermission).not.toHaveBeenCalledWith("user:manage");
  });

  it("short-circuits when the user lacks Quick Services manage permission", async () => {
    mocks.requireApiPermission.mockResolvedValueOnce(Response.json({ error: "Insufficient permissions" }, { status: 403 }));

    const response = await rootRoute.GET(new Request("http://local/api/quick-services"));

    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({ error: "Insufficient permissions" });
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

  it("scopes the install-target server picker by teamWhere for non-admin operators", async () => {
    mocks.requireApiPermission.mockResolvedValueOnce({
      session: {
        userId: "u2",
        username: "ops",
        roles: ["operator"],
        mustChangePassword: false,
        currentTeamId: "team_a",
      },
    });
    mocks.serverFindMany.mockResolvedValueOnce([
      { id: "srv_a", name: "team-a-vps", host: "10.0.0.1" },
    ]);

    const response = await rootRoute.GET(new Request("http://local/api/quick-services"));
    const json = await body(response);

    expect(response.status).toBe(200);
    expect(mocks.serverFindMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        OR: [{ teamId: "team_a" }, { teamId: null }],
      },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true, host: true },
    });
    expect(json.servers).toEqual([{ id: "srv_a", name: "team-a-vps", host: "10.0.0.1" }]);
  });

  it("queues local service installation for the authorized user", async () => {
    const response = await rootRoute.POST(new Request("http://local/api/quick-services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alist", customPort: 5244 }),
    }));

    expect(response.status).toBe(202);
    expect(mocks.enqueueQuickServiceJob).toHaveBeenCalledWith({
      title: "Installed quick service: AList",
      teamId: null,
      createdBy: "u1",
      payload: expect.objectContaining({
        action: "install",
        slug: "alist",
        instanceKey: "hub-host",
        serverId: null,
        template: expect.objectContaining({ slug: "alist", initialPassword: expect.any(String) }),
        customPort: 5244,
        installNoticeCredentials: [
          { label: "Account", value: "admin" },
          { label: "Initial password", value: expect.any(String) },
        ],
        installNoticeNotes: ["AList initial admin password has been auto-set after container startup."],
      }),
    });
    expect(mocks.installService).not.toHaveBeenCalled();
    const json = await body(response) as { notice: { credentials: Array<{ label: string; value: string }> }; queued: boolean; jobId: string; taskId: string };
    expect(json).toMatchObject({ queued: true, jobId: "job_qs_1", taskId: "job:job_qs_1" });
    expect(json.notice.credentials).toEqual([
      { label: "Account", value: "admin" },
      { label: "Initial password", value: expect.any(String) },
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
    expect(await body(response)).toEqual({ error: "port 5244 is already in use (AList), please change port and retry", portConflict: true, usedBy: "AList" });
    expect(mocks.installService).not.toHaveBeenCalled();
  });

  it("maps enqueue-time port conflicts to 409", async () => {
    mocks.enqueueQuickServiceJob.mockRejectedValueOnce(new Error("port 5244 is already in use"));

    const response = await rootRoute.POST(new Request("http://local/api/quick-services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alist" }),
    }));

    expect(response.status).toBe(409);
    expect(await body(response)).toEqual({ error: "port 5244 is already in use", portConflict: true });
  });

  it("queues slug actions through the guarded route", async () => {
    const response = await slugRoute.PATCH(new Request("http://local/api/quick-services/alist", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "sync" }),
    }), { params: Promise.resolve({ slug: "alist" }) });

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({ success: true, queued: true, jobId: "job_qs_1", taskId: "job:job_qs_1", status: "PENDING" });
    expect(mocks.enqueueQuickServiceJob).toHaveBeenCalledWith(expect.objectContaining({ createdBy: "u1", payload: { action: "sync", slug: "alist", instanceKey: "hub-host", serverId: null } }));
    expect(mocks.syncServiceStatus).not.toHaveBeenCalled();
  });

  it("queues service update through the guarded slug route", async () => {
    const response = await slugRoute.PATCH(new Request("http://local/api/quick-services/alist", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update" }),
    }), { params: Promise.resolve({ slug: "alist" }) });

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({ success: true, queued: true, jobId: "job_qs_1", taskId: "job:job_qs_1" });
    expect(mocks.enqueueQuickServiceJob).toHaveBeenCalledWith(expect.objectContaining({ payload: { action: "update", slug: "alist", instanceKey: "hub-host", serverId: null } }));
    expect(mocks.updateService).not.toHaveBeenCalled();
  });

  it("queues service uninstall through the guarded route", async () => {
    const response = await slugRoute.DELETE(new Request("http://local/api/quick-services/alist", { method: "DELETE" }), { params: Promise.resolve({ slug: "alist" }) });

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({ success: true, queued: true, deleteVolumes: false, jobId: "job_qs_1", taskId: "job:job_qs_1" });
    expect(mocks.enqueueQuickServiceJob).toHaveBeenCalledWith(expect.objectContaining({ payload: { action: "uninstall", slug: "alist", deleteVolumes: false, instanceKey: "hub-host", serverId: null } }));
    expect(mocks.uninstallService).not.toHaveBeenCalled();
  });

  it("passes deleteVolumes option when uninstalling with data removal", async () => {
    const response = await slugRoute.DELETE(new Request("http://local/api/quick-services/alist", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deleteVolumes: true }),
    }), { params: Promise.resolve({ slug: "alist" }) });

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({ success: true, queued: true, deleteVolumes: true });
    expect(mocks.enqueueQuickServiceJob).toHaveBeenCalledWith(expect.objectContaining({ payload: { action: "uninstall", slug: "alist", deleteVolumes: true, instanceKey: "hub-host", serverId: null } }));
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
