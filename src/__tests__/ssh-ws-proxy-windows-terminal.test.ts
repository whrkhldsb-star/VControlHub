import { describe, expect, it, vi } from "vitest";

/**
 * Windows SSH-terminal resolution: terminals ride the OpenSSH Server captured
 * by the cloud-storage binding — the SFTP port/username/host-key live on the
 * bound StorageNode, the SFTP password on the server row. Without a binding
 * there is no shell to open (rejection must stay silent, matching Linux
 * credential-less behavior).
 */
const mocks = vi.hoisted(() => ({
  serverFindFirst: vi.fn(),
  storageNodeFindUnique: vi.fn(),
  decryptServerPassword: vi.fn((value: string) => `dec:${value}`),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findFirst: mocks.serverFindFirst },
    storageNode: { findUnique: mocks.storageNodeFindUnique },
  },
}));
vi.mock("@/lib/ssh/ssh-key-crypto", async () => (await import("@/test/ssh-key-crypto-mock")).withStoredKeyHelpers({
  decryptServerPassword: mocks.decryptServerPassword,
  decryptSshPrivateKey: vi.fn(),
  decryptSshKeyPassphrase: vi.fn(),
}));

import { resolveServerConnection } from "../ssh-ws-proxy";

vi.mock("@/lib/auth/session", () => ({
  verifySessionToken: vi.fn(async () => ({ userId: "u1", username: "u1", roles: [], permissions: [], mustChangePassword: false, currentTeamId: null })),
}));

const baseServer = {
  id: "win",
  name: "win-node",
  host: "192.0.2.10",
  port: 3389,
  username: "Administrator",
  enabled: true,
  operatingSystem: "WINDOWS",
  connectionType: "PASSWORD",
  password: "enc-sftp-pass",
  hostKeySha256: null,
  teamId: null,
  sshKey: null,
};

function session() {
  return { userId: "u1", username: "u1", roles: [] as never[], permissions: [] as never[], mustChangePassword: false, currentTeamId: null };
}

describe("ssh-ws-proxy Windows terminal resolution", () => {
  it("resolves through the bound storage node's SFTP endpoint", async () => {
    mocks.serverFindFirst.mockResolvedValue(baseServer);
    mocks.storageNodeFindUnique.mockResolvedValue({
      port: 2222,
      username: "sftp-user",
      hostKeySha256: "pin-sha",
    });
    const conn = await resolveServerConnection("win", session() as never);
    expect(conn).toMatchObject({
      host: "192.0.2.10",
      port: 2222,
      username: "sftp-user",
      connectionType: "PASSWORD",
      hostKeySha256: "pin-sha",
      password: "dec:enc-sftp-pass",
    });
    expect(mocks.storageNodeFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serverId: "win" } }),
    );
  });

  it("rejects silently when no cloud-storage binding exists", async () => {
    mocks.serverFindFirst.mockResolvedValue(baseServer);
    mocks.storageNodeFindUnique.mockResolvedValue(null);
    expect(await resolveServerConnection("win", session() as never)).toBeNull();
  });

  it("rejects when the binding exists but the server row lost its SFTP password", async () => {
    mocks.serverFindFirst.mockResolvedValue({ ...baseServer, password: null });
    mocks.storageNodeFindUnique.mockResolvedValue({ port: 22, username: "u", hostKeySha256: null });
    expect(await resolveServerConnection("win", session() as never)).toBeNull();
  });
});
