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
      port: 2222,
      username: "root",
      connectionType: "SSH_KEY",
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

  it("describes ssh-key connection details for review screens", () => {
    expect(
      getServerConnectionSummary({
        host: "10.0.0.8",
        port: 22,
        username: "ubuntu",
        connectionType: "SSH_KEY",
        sshKeyName: "prod-root-key",
      }),
    ).toContain("SSH 密钥 prod-root-key");
  });
});
