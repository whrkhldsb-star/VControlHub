import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, syncMock, listMock, getRemoteAppsMock } = vi.hoisted(() => ({
  prismaMock: {
    appSource: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  syncMock: {
    syncAllSources: vi.fn(),
    syncSource: vi.fn(),
    getRemoteApps: vi.fn(),
  },
  listMock: vi.fn(),
  getRemoteAppsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: vi.fn(async (_request, _options, handler) =>
    handler({ session: { userId: "u_admin" } }),
  ),
}));
vi.mock("@/lib/quick-service/app-source-sync", () => ({
  getRemoteApps: syncMock.getRemoteApps,
  syncAllSources: syncMock.syncAllSources,
  syncSource: syncMock.syncSource,
}));
vi.mock("@/lib/quick-service/service", () => ({
  listQuickServices: listMock,
}));
vi.mock("@/lib/quick-service/catalog", () => ({
  SERVICE_CATALOG: [
    {
      slug: "nginx",
      name: "Nginx",
      category: "web",
      icon: "🌐",
      description: "HTTP server",
      image: "nginx:latest",
      defaultPort: 80,
      internalPort: 80,
      path: "/srv/nginx",
    },
  ],
}));
vi.mock("@/lib/storage/direct-access-url", () => ({
  normalizePublicHttpUrl: (url: string) => url,
}));

import { DELETE, GET, PATCH, POST } from "../route";

describe("/api/app-sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.appSource.findMany.mockResolvedValue([]);
    listMock.mockResolvedValue([]);
    syncMock.getRemoteApps.mockResolvedValue([]);
  });

  describe("GET", () => {
    it("merges local catalog with installed services and remote apps", async () => {
      prismaMock.appSource.findMany.mockResolvedValue([
        { id: "src_1", name: "main", url: "https://example/x.json", enabled: true },
      ]);
      listMock.mockResolvedValue([
        {
          id: "svc_1",
          slug: "nginx",
          status: "running",
          containerId: "c_1",
          port: 8080,
          error: null,
        },
      ]);
      syncMock.getRemoteApps.mockResolvedValue([
        {
          slug: "redis",
          name: "Redis",
          category: "db",
          icon: "🔴",
          description: "KV",
          image: "redis:7",
          defaultPort: 6379,
          internalPort: 6379,
          path: "/srv/redis",
          sourceName: "main",
          stars: 100,
          monthlyPulls: 50,
        },
      ]);

      const response = await GET(new Request("http://local/api/app-sources"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.sources).toHaveLength(1);
      // Installed nginx: status reflects the running service
      const nginxLocal = body.localCatalog.find((c: { slug: string }) => c.slug === "nginx");
      expect(nginxLocal).toMatchObject({
        slug: "nginx",
        status: "running",
        containerId: "c_1",
        port: 8080,
        source: "local",
      });
      // Remote app: not installed → status "available"
      expect(body.remoteCatalog).toEqual([
        expect.objectContaining({
          slug: "redis",
          status: "available",
          source: "main",
          stars: 100,
        }),
      ]);
    });

    it("skips remote app fetch when includeApps=false", async () => {
      const response = await GET(
        new Request("http://local/api/app-sources?includeApps=false"),
      );
      expect(response.status).toBe(200);
      expect(syncMock.getRemoteApps).not.toHaveBeenCalled();
    });

    it("includes remote apps by default when includeApps is omitted", async () => {
      await GET(new Request("http://local/api/app-sources"));
      expect(syncMock.getRemoteApps).toHaveBeenCalledOnce();
    });
  });

  describe("POST", () => {
    it("creates a source with valid input", async () => {
      prismaMock.appSource.create.mockResolvedValue({
        id: "src_new",
        name: "extra",
        displayName: "Extra",
        url: "https://example.com/sources.json",
        type: "json",
      });
      const response = await POST(
        new Request("http://local/api/app-sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "extra",
            displayName: "Extra",
            url: "https://example.com/sources.json",
            type: "json",
          }),
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(201);
      expect(body.source).toMatchObject({ id: "src_new", name: "extra" });
    });

    it("rejects invalid name (uppercase letters)", async () => {
      const response = await POST(
        new Request("http://local/api/app-sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "BadName",
            displayName: "X",
            url: "https://example.com/x.json",
          }),
        }),
      );
      expect(response.status).toBe(400);
      expect(prismaMock.appSource.create).not.toHaveBeenCalled();
    });

    it("rejects malformed url", async () => {
      const response = await POST(
        new Request("http://local/api/app-sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "ok",
            displayName: "X",
            url: "not-a-url",
          }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it("rejects empty body gracefully", async () => {
      const response = await POST(
        new Request("http://local/api/app-sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "null",
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  describe("PATCH", () => {
    it("syncs a single source when sourceId is provided", async () => {
      syncMock.syncSource.mockResolvedValue({ ok: true, count: 5 });
      const response = await PATCH(
        new Request("http://local/api/app-sources", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "sync", sourceId: "src_1" }),
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(syncMock.syncSource).toHaveBeenCalledWith("src_1");
      expect(body.result).toMatchObject({ ok: true, count: 5 });
    });

    it("syncs all sources when sourceId is omitted", async () => {
      syncMock.syncAllSources.mockResolvedValue([{ ok: true }, { ok: true }]);
      const response = await PATCH(
        new Request("http://local/api/app-sources", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "sync" }),
        }),
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(syncMock.syncAllSources).toHaveBeenCalledOnce();
      expect(body.results).toHaveLength(2);
    });

    it("toggles source.enabled", async () => {
      prismaMock.appSource.update.mockResolvedValue({});
      const response = await PATCH(
        new Request("http://local/api/app-sources", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "toggle",
            sourceId: "src_1",
            enabled: false,
          }),
        }),
      );
      expect(response.status).toBe(200);
      expect(prismaMock.appSource.update).toHaveBeenCalledWith({
        where: { id: "src_1" },
        data: { enabled: false },
      });
    });

    it("rejects unknown action", async () => {
      const response = await PATCH(
        new Request("http://local/api/app-sources", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "destroy" }),
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  describe("DELETE", () => {
    it("deletes by id from query", async () => {
      prismaMock.appSource.delete.mockResolvedValue({});
      const response = await DELETE(
        new Request("http://local/api/app-sources?id=src_1", {
          method: "DELETE",
        }),
      );
      expect(response.status).toBe(200);
      expect(prismaMock.appSource.delete).toHaveBeenCalledWith({
        where: { id: "src_1" },
      });
    });
  });
});
