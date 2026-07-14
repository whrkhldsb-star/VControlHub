import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, withApiRouteMock } = vi.hoisted(() => ({
  prismaMock: { downloadTask: { findMany: vi.fn() } },
  withApiRouteMock: vi.fn(async (
    request: Request,
    _options: unknown,
    handler: (context: { session: { userId: string; username: string; roles: string[]; currentTeamId: string | null } }) => Promise<Response>,
  ) => handler({ session: { userId: "u_1", username: "alice", roles: ["viewer"], currentTeamId: "team_1" } })),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/http/api-guard", () => ({ withApiRoute: withApiRouteMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: () => false }));
vi.mock("@/lib/downloads/route-helpers", () => ({ canAccessDownloadTask: async () => true }));

import { GET } from "../route";

describe("GET /api/downloads/recent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns recent completed downloads in the current team scope with storage-node paths", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([
      {
        id: "task_1",
        url: "https://example.com/releases/app.zip?token=x",
        fileName: null,
        targetPath: "/srv/cloud/releases",
        updatedAt: new Date("2026-07-14T10:00:00.000Z"),
        server: {
          storageNode: {
            id: "node_1",
            name: "Tokyo storage",
            driver: "SFTP",
            basePath: "/srv/cloud",
          },
        },
      },
    ]);

    const response = await GET(new Request("https://example.com/api/downloads/recent"));

    expect(response.status).toBe(200);
    expect(prismaMock.downloadTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: "COMPLETED",
        OR: [{ teamId: "team_1" }, { teamId: null }],
        server: { storageNode: { isNot: null } },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }));
    await expect(response.json()).resolves.toEqual({
      downloads: [{
        id: "task_1",
        fileName: "app.zip",
        path: "releases",
        completedAt: "2026-07-14T10:00:00.000Z",
        storageNode: { id: "node_1", name: "Tokyo storage", driver: "SFTP" },
      }],
    });
  });

  it("omits records whose target path cannot be mapped inside the storage node", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([
      {
        id: "task_bad",
        url: "https://example.com/file.iso",
        fileName: "file.iso",
        targetPath: "/outside/downloads",
        updatedAt: new Date("2026-07-14T10:00:00.000Z"),
        server: { storageNode: { id: "node_1", name: "Storage", driver: "SFTP", basePath: "/srv/cloud" } },
      },
    ]);

    const response = await GET(new Request("https://example.com/api/downloads/recent"));
    await expect(response.json()).resolves.toEqual({ downloads: [] });
  });
});
