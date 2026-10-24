import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, withApiRouteMock } = vi.hoisted(() => ({
  prismaMock: { downloadTask: { findMany: vi.fn() } },
  withApiRouteMock: vi.fn(async (
    _request: Request,
    _options: unknown,
    handler: (context: { session: { userId: string; username: string; roles: string[]; currentTeamId: string | null } }) => Promise<Response>,
  ) => handler({ session: { userId: "u_1", username: "alice", roles: ["viewer"], currentTeamId: "team_1" } })),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/http/api-guard", () => ({ withApiRoute: withApiRouteMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: () => false }));
vi.mock("@/lib/downloads/route-helpers", () => ({
  // Tasks under a path the account has no grant on are hidden from it.
  canAccessDownloadTask: async ({ task }: { task: { id: string } }) => !task.id.startsWith("hidden"),
}));

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
        teamId: "team_1",
        server: { storageNode: { isNot: null } },
      },
      orderBy: { updatedAt: "desc" },
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

  it("still lists the account's own recent downloads when newer ones elsewhere are hidden from it", async () => {
    // Only the newest 8 were read, then filtered: an account with narrow
    // grants saw an empty list while others downloaded more recently.
    const task = (id: string, minute: number) => ({
      id,
      url: `https://example.com/${id}.zip`,
      fileName: `${id}.zip`,
      targetPath: "/srv/cloud/releases",
      updatedAt: new Date(Date.UTC(2026, 6, 14, 10, 59 - minute)),
      server: { storageNode: { id: "node_1", name: "Storage", driver: "SFTP", basePath: "/srv/cloud" } },
    });
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => task(`hidden_${i}`, i)),
      ...Array.from({ length: 9 }, (_, i) => task(`mine_${i}`, 10 + i)),
    ];
    prismaMock.downloadTask.findMany.mockImplementationOnce(async ({ take }: { take: number }) => rows.slice(0, take));

    const response = await GET(new Request("https://example.com/api/downloads/recent"));
    const { downloads } = (await response.json()) as { downloads: Array<{ id: string }> };

    expect(downloads.map((download) => download.id)).toEqual(Array.from({ length: 8 }, (_, i) => `mine_${i}`));
  });
});
