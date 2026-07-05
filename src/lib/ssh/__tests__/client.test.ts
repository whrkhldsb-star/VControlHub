import { describe, expect, it, vi } from "vitest";
import type { ConnectConfig } from "ssh2";

import { createSshConfigForTest } from "../client";
import { requireApprovedSshHostKey, SshHostKeyApprovalRequiredError } from "../host-key";

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  return {
    ...actual,
    execRemoteCommand: vi.fn(async (input: import("../client").SshConnectionParams & { command: string }) => {
      input.onHostKeySha256?.("SHA256:seen");
      throw new Error("Host denied before auth");
    }),
  };
});

describe("SSH client host key verification", () => {
  it("installs a sha256 hostVerifier when a host key fingerprint is configured", () => {
    const config = createSshConfigForTest({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
      hostKeySha256: "SHA256:abcdef",
    }) as ConnectConfig;

    expect(config.hostHash).toBe("sha256");
    const verifier = config.hostVerifier as unknown as (hash: string) => boolean;
    expect(verifier("abcdef")).toBe(true);
    expect(verifier("different")).toBe(false);
  });

  it("captures first-contact host key without accepting it and requires explicit fingerprint approval", async () => {
    await expect(requireApprovedSshHostKey({
      ssh: { host: "203.0.113.10", port: 22, username: "root" },
    })).rejects.toMatchObject({
      name: "SshHostKeyApprovalRequiredError",
      hostKeySha256: "SHA256:seen",
    } satisfies Partial<SshHostKeyApprovalRequiredError>);

    await expect(requireApprovedSshHostKey({
      ssh: { host: "203.0.113.10", port: 22, username: "root" },
      approvedHostKeySha256: "SHA256:seen",
    })).resolves.toBe("SHA256:seen");
  });
});
