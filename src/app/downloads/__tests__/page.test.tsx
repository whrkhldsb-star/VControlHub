import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: vi.fn().mockResolvedValue({
    userId: "u1",
    username: "operator",
    roles: ["operator"],
    permissions: ["storage:read", "storage:write"],
    currentTeamId: "team-a",
    mustChangePassword: false,
  }),
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: vi.fn((session, permission: string) => {
    if (permission === "team:manage") return false;
    return session.permissions.includes(permission);
  }),
}));

vi.mock("../downloads-client", () => ({
  DownloadsClient: vi.fn(({ servers }: { servers: Array<{ name: string; accessStatusLabel?: string }> }) => (
    <div data-testid="downloads-client">{servers.map((server) => `${server.name}:${server.accessStatusLabel}`).join(", ")}</div>
  )),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "srv1",
          name: "下载 VPS",
          host: "203.0.113.20",
          storageNode: { id: "node1", basePath: "/data/downloads", driver: "SFTP", host: "203.0.113.20", port: 22, directAccessMode: "DIRECT", publicBaseUrl: "https://files.example.com", directAccessExpiresSeconds: 300 },
        },
      ]),
    },
  },
}));

import { prisma } from "@/lib/db";
import DownloadsPage from "../page";

const serverFindManyMock = vi.mocked(prisma.server.findMany);

describe("DownloadsPage", () => {
  beforeEach(() => {
    serverFindManyMock.mockClear();
  });

  it("hydrates only download-capable VPS targets within team scope", async () => {
    render(await DownloadsPage());

    expect(screen.getByTestId("downloads-client")).toHaveTextContent("下载 VPS:当前：直连");
    expect(serverFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          { OR: [{ teamId: "team-a" }, { teamId: null }] },
          {
            enabled: true,
            storageNode: { isNot: null },
            OR: [{ sshKeyId: { not: null } }, { password: { not: null } }],
          },
        ],
      },
      orderBy: { name: "asc" },
      take: 200,
      select: expect.objectContaining({
        id: true,
        name: true,
        host: true,
        storageNode: { select: { id: true, basePath: true, driver: true, host: true, port: true, directAccessMode: true, publicBaseUrl: true, directAccessExpiresSeconds: true } },
      }),
    }));
  });
});
