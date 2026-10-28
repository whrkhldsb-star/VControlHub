// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ssh/ssh-key-crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ssh/ssh-key-crypto")>()),
  decryptServerPassword: (value: string) => value,
  decryptStoredSshKey: () => ({ privateKey: "key" }),
}));

import { resolveStorageSshCredentials, type StorageSshCredentialNode } from "../ssh-credentials";

const server = (overrides: Partial<NonNullable<StorageSshCredentialNode["server"]>> = {}): NonNullable<StorageSshCredentialNode["server"]> => ({
  id: "srv1", managementMode: "DIRECT", operatingSystem: "LINUX", host: "203.0.113.5", port: 22, username: "root",
  connectionType: "SSH_KEY", password: null, sshKey: {} as never, hostKeySha256: "SHA256:new-key", ...overrides,
});

describe("resolveStorageSshCredentials host key pin", () => {
  it("follows the server's pin for a node that takes its host from a Linux server", () => {
    // The server's key was approved again after a reinstall; the copy the node kept is the old one.
    const credentials = resolveStorageSshCredentials({ host: null, port: null, username: null, hostKeySha256: "SHA256:old-key", server: server() });
    expect(credentials.hostKeySha256).toBe("SHA256:new-key");
  });

  it("keeps a node's own pin when the node has its own host, or the server is Windows", () => {
    expect(resolveStorageSshCredentials({ host: "198.51.100.9", port: 22, username: "u", hostKeySha256: "SHA256:own", server: server() }).hostKeySha256).toBe("SHA256:own");
    expect(resolveStorageSshCredentials({ host: null, port: null, username: null, hostKeySha256: "SHA256:openssh", server: server({ operatingSystem: "WINDOWS" }) }).hostKeySha256).toBe("SHA256:openssh");
  });

  it("falls back to the node's pin when the server has none", () => {
    expect(resolveStorageSshCredentials({ host: null, port: null, username: null, hostKeySha256: "SHA256:old-key", server: server({ hostKeySha256: null }) }).hostKeySha256).toBe("SHA256:old-key");
  });
});
