import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: vi.fn().mockResolvedValue({
    userId: "u1",
    username: "operator",
    roles: ["operator"],
    permissions: ["storage:read", "storage:write"],
    mustChangePassword: false,
  }),
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: vi.fn((session, permission: string) => session.permissions.includes(permission)),
}));

vi.mock("../downloads-client", () => ({
  DownloadsClient: vi.fn(({ servers }: { servers: Array<{ name: string }> }) => (
    <div data-testid="downloads-client">{servers.map((server) => server.name).join(", ")}</div>
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
          storageNode: { id: "node1", basePath: "/data/downloads", driver: "SFTP" },
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

  it("bounds enabled target server hydration for download creation", async () => {
    render(await DownloadsPage());

    expect(screen.getByTestId("downloads-client")).toHaveTextContent("下载 VPS");
    expect(serverFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { enabled: true },
      orderBy: { name: "asc" },
      take: 200,
      select: expect.objectContaining({
        id: true,
        name: true,
        host: true,
        storageNode: { select: { id: true, basePath: true, driver: true } },
      }),
    }));
  });
});
