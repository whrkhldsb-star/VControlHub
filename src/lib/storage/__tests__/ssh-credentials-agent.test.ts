/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { resolveStorageSshCredentials } from "../ssh-credentials";

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
});
