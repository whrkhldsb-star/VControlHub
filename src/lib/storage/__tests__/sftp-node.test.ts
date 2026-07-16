import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    storageNode: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/storage/ssh-credentials", () => ({
  resolveStorageSshCredentials: vi.fn(() => ({
    host: "203.0.113.10",
    port: 22,
    username: "root",
    connectionType: "SSH_KEY",
    privateKey: "KEY",
  })),
}));

import { getSftpNodeConnection } from "@/lib/storage/sftp-node";
import { NotFoundError } from "@/lib/errors";

const sftpNode = {
  id: "node_other_team",
  name: "other",
  driver: "SFTP",
  basePath: "/data",
  host: null,
  port: null,
  username: null,
  hostKeySha256: "SHA256:nodepin",
  serverId: "srv_1",
  server: {
    id: "srv_1",
    host: "203.0.113.10",
    port: 22,
    username: "root",
    connectionType: "SSH_KEY",
    password: null,
    hostKeySha256: "SHA256:serverpin",
    sshKey: { privateKey: "PRIVATE" },
  },
};

describe("getSftpNodeConnection team scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects hostKeySha256 from node and linked server for pin verification", async () => {
    prismaMock.storageNode.findFirst.mockResolvedValueOnce(sftpNode);

    await getSftpNodeConnection("node_other_team", {
      userId: "u_1",
      roles: ["operator"],
      currentTeamId: "team_a",
    });

    expect(prismaMock.storageNode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          hostKeySha256: true,
          server: expect.objectContaining({
            select: expect.objectContaining({
              hostKeySha256: true,
            }),
          }),
        }),
      }),
    );
  });

  it("applies teamWhere for non-admin sessions when loading by id", async () => {
    prismaMock.storageNode.findFirst.mockResolvedValueOnce(sftpNode);

    await getSftpNodeConnection("node_other_team", {
      userId: "u_1",
      roles: ["operator"],
      currentTeamId: "team_a",
    });

    expect(prismaMock.storageNode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "node_other_team",
          OR: [{ teamId: "team_a" }, { teamId: null }],
        }),
      }),
    );
  });

  it("does not team-filter admins with team:manage", async () => {
    prismaMock.storageNode.findFirst.mockResolvedValueOnce(sftpNode);

    await getSftpNodeConnection("node_other_team", {
      userId: "admin",
      roles: ["admin"],
      currentTeamId: "team_a",
    });

    expect(prismaMock.storageNode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "node_other_team" },
      }),
    );
  });

  it("throws NotFoundError when team-scoped lookup misses", async () => {
    prismaMock.storageNode.findFirst.mockResolvedValueOnce(null);

    await expect(
      getSftpNodeConnection("node_other_team", {
        userId: "u_1",
        roles: ["operator"],
        currentTeamId: "team_a",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
