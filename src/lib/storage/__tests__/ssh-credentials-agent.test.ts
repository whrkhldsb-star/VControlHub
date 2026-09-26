/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { resolveStorageSshCredentials, resolveStorageSshPort } from "../ssh-credentials";

describe("Agent-only storage credentials", () => {
  it("uses the linked Agent when no password or private key remains", () => {
    expect(resolveStorageSshCredentials({
      server: {
        id: "srv_agent",
        managementMode: "AGENT",
        host: "203.0.113.10",
        port: 22,
        username: "root",
        connectionType: "SSH_KEY",
        password: null,
        sshKey: null,
      },
    })).toMatchObject({ agentServerId: "srv_agent", host: "203.0.113.10" });
  });

  it("still rejects a credential-less direct node", () => {
    expect(() => resolveStorageSshCredentials({
      server: {
        id: "srv_direct",
        managementMode: "DIRECT",
        host: "203.0.113.11",
        username: "root",
        connectionType: "PASSWORD",
        password: null,
      },
    })).toThrow();
  });

  it("uses Windows OpenSSH even when the Windows management agent is enabled", () => {
    const resolved = resolveStorageSshCredentials({
      port: 22,
      username: "storage-user",
      server: {
        id: "srv_windows",
        operatingSystem: "WINDOWS",
        managementMode: "AGENT",
        host: "203.0.113.12",
        port: 3389,
        username: "RdpAdmin",
        connectionType: "PASSWORD",
        password: "sftp-secret",
      },
    });
    expect(resolved).toMatchObject({ port: 22, username: "storage-user", password: "sftp-secret" });
    expect(resolved.agentServerId).toBeUndefined();
  });

  it("defaults a Windows bound storage node to SSH port 22 rather than its RDP port", () => {
    expect(resolveStorageSshPort({ server: { operatingSystem: "WINDOWS", port: 3389 } })).toBe(22);
  });
});
