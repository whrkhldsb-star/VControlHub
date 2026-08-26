import { describe, expect, it } from "vitest";

import {
  getServerConnectionSummary,
  normalizeServerInput,
} from "@/lib/server/config";

describe("server config helpers", () => {
  it("normalizes ssh-key based server onboarding input", () => {
    const result = normalizeServerInput({
      name: " hk-1 ",
      host: " 10.0.0.5 ",
      port: 2222,
      username: " root ",
      connectionType: "SSH_KEY",
      sshKeyId: "key_1",
      tags: [" prod ", " cn-hk ", "", "prod"],
      description: " main node ",
    });

    expect(result).toEqual({
      name: "hk-1",
      host: "10.0.0.5",
      managementMode: "DIRECT",
      port: 2222,
      username: "root",
      connectionType: "SSH_KEY",
      costAutoSync: false,
      costCurrency: "CNY",
      costMonthlyAmount: null,
      costProvider: null,
      sshKeyId: "key_1",
      storagePath: "/root/drive",
      password: null,
      tags: ["prod", "cn-hk"],
      description: "main node",
    });
  });

  it("defaults blank usernames to root", () => {
    const result = normalizeServerInput({
      name: " node ",
      host: " 203.0.113.10 ",
      connectionType: "PASSWORD",
      password: "secret",
      username: "   ",
    });

    expect(result.username).toBe("root");
  });

  it("rejects host/username that could be reinterpreted as ssh CLI options", () => {
    const base = {
      name: "node",
      connectionType: "PASSWORD" as const,
      password: "secret",
    };
    // Leading-dash host/username → ssh argv-injection (e.g. -oProxyCommand=…).
    expect(() =>
      normalizeServerInput({ ...base, host: "-oProxyCommand=calc", username: "root" }),
    ).toThrow(/host/i);
    expect(() =>
      normalizeServerInput({ ...base, host: "10.0.0.5", username: "-oProxyCommand=calc" }),
    ).toThrow(/username/i);
    // Whitespace/metacharacters are not valid hostnames either.
    expect(() =>
      normalizeServerInput({ ...base, host: "10.0.0.5 -oProxyCommand=x", username: "root" }),
    ).toThrow(/host/i);
  });

  it("accepts legitimate hosts and usernames (ipv6, dotted, service accounts)", () => {
    expect(() =>
      normalizeServerInput({
        name: "node",
        host: "2001:db8::1",
        username: "deploy.svc-01@corp",
        connectionType: "PASSWORD",
        password: "secret",
      }),
    ).not.toThrow();
  });

  it("describes ssh-key connection details for review screens", () => {
    expect(
      getServerConnectionSummary({
        host: "10.0.0.8",
        port: 22,
        username: "ubuntu",
        connectionType: "SSH_KEY",
        sshKeyName: "prod-root-key",
      }),
    ).toContain("ubuntu@10.0.0.8:22, using SSH key prod-root-key");
  });
});
