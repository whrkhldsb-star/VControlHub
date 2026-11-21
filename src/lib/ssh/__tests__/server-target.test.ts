import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnabledServerForSftp, loadEnabledServerForSsh } from "../server-target";

const { serverLookup, storageLookup, home } = vi.hoisted(() => ({
  serverLookup: vi.fn(), storageLookup: vi.fn(), home: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { server: { findUnique: serverLookup }, storageNode: { findUnique: storageLookup } } }));
vi.mock("../client", async (original) => ({ ...await original<typeof import("../client")>(), resolveRemoteHomeDirectory: home }));

const server = {
  id: "srv", teamId: "old", host: "host", port: 22, username: "ops", enabled: true, operatingSystem: "LINUX",
  managementMode: "DIRECT", connectionType: "PASSWORD", password: "secret", sshKeyId: null, sshKey: null, hostKeySha256: null,
};

describe("persisted SSH and SFTP targets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a pin before the first Linux home lookup or command", async () => {
    serverLookup.mockResolvedValue(server);
    await expect(loadEnabledServerForSftp("srv", "old")).rejects.toThrow();
    await expect(loadEnabledServerForSsh("srv", "old")).rejects.toThrow();
    expect(home).not.toHaveBeenCalled();
  });

  it("keeps a credential-free Agent target available without an SSH pin", async () => {
    serverLookup.mockResolvedValue({ ...server, managementMode: "AGENT", password: null, agentTokenHash: "token" });
    home.mockResolvedValue("/srv/home");
    await expect(loadEnabledServerForSftp("srv", "old")).resolves.toMatchObject({ rootPath: "/srv/home", ssh: {
      agentServerId: "srv", expectedIdentity: { serverId: "srv", tokenHash: "token", teamId: "old" },
    } });
  });

  it("refuses unpinned Windows OpenSSH transfers", async () => {
    serverLookup.mockResolvedValue({ ...server, operatingSystem: "WINDOWS" });
    storageLookup.mockResolvedValue({ driver: "SFTP", host: null, port: 22, username: "ops", teamId: "old", hostKeySha256: null });
    await expect(loadEnabledServerForSftp("srv", "old")).rejects.toThrow();
    expect(home).not.toHaveBeenCalled();
  });

  it("includes the originally authorized SSH endpoint on every stage's reload", async () => {
    const endpoint = { host: "old-host", port: 2202, username: "ops", hostKeySha256: "saved-pin",
      managementMode: "AGENT" as const, agentTokenHash: "paired-agent" };
    serverLookup.mockResolvedValue(null);
    await expect(loadEnabledServerForSsh("srv", "old", endpoint)).rejects.toThrow();
    expect(serverLookup).toHaveBeenCalledWith(expect.objectContaining({ where: { ...endpoint, id: "srv", teamId: "old" } }));
  });

  it.each(["old", null])("keeps the authorized owner %s in the connection query", async (teamId) => {
    serverLookup.mockResolvedValue(null);
    await expect(loadEnabledServerForSftp("srv", teamId)).rejects.toThrow();
    expect(serverLookup).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "srv", teamId } }));
    expect(home).not.toHaveBeenCalled();
  });
});
