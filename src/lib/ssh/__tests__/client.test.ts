import { describe, expect, it, vi } from "vitest";
import type { ConnectConfig } from "ssh2";

import { buildSshParamsFromServer, createVerifiedSshConfig } from "../client";
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
	it("honors SSH_ENFORCE_HOST_KEY_PIN when callers omit an explicit override", () => {
		process.env.SSH_ENFORCE_HOST_KEY_PIN = "true";
		try {
			const config = createVerifiedSshConfig({ host: "203.0.113.10", port: 22, username: "root", password: "secret" }) as ConnectConfig;
			expect(config.hostHash).toBe("sha256");
			const verifier = config.hostVerifier as unknown as (hash: string) => boolean;
			expect(verifier("unknown-host-key")).toBe(false);
		} finally {
			delete process.env.SSH_ENFORCE_HOST_KEY_PIN;
		}
	});

	it("lets an explicit bootstrap override disable the global pin requirement", () => {
		process.env.SSH_ENFORCE_HOST_KEY_PIN = "true";
		try {
			const config = createVerifiedSshConfig({ host: "203.0.113.10", port: 22, username: "root", password: "secret", enforceHostKeyPin: false }) as ConnectConfig;
			expect(config.hostVerifier).toBeUndefined();
		} finally {
			delete process.env.SSH_ENFORCE_HOST_KEY_PIN;
		}
	});
  it("installs a sha256 hostVerifier when a host key fingerprint is configured", () => {
    const config = createVerifiedSshConfig({
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

  it("converts ssh2 hex host hashes to standard OpenSSH Base64 fingerprints", () => {
    const observed: string[] = [];
    const config = createVerifiedSshConfig({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      password: "secret",
      onHostKeySha256: (fingerprint) => observed.push(fingerprint),
    }) as ConnectConfig;
    const verifier = config.hostVerifier as unknown as (hash: string) => boolean;
    const hex = "c6e6baffe9fd581a60c49df60c5bc7e3798374811eb41957a21fa3c03384ac13";

    expect(verifier(hex)).toBe(true);
    expect(observed).toEqual(["SHA256:xua6/+n9WBpgxJ32DFvH43mDdIEetBlXoh+jwDOErBM"]);
  });

  it("accepts a standard Base64 pin while retaining legacy hex compatibility", () => {
    const hex = "c6e6baffe9fd581a60c49df60c5bc7e3798374811eb41957a21fa3c03384ac13";
    const standardPin = "SHA256:xua6/+n9WBpgxJ32DFvH43mDdIEetBlXoh+jwDOErBM";
    const config = createVerifiedSshConfig({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      password: "secret",
      hostKeySha256: standardPin,
    }) as ConnectConfig;
    const verifier = config.hostVerifier as unknown as (hash: string) => boolean;

    expect(verifier(hex)).toBe(true);
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

  it("selects credentials strictly from the configured connection type", async () => {
    const passwordParams = await buildSshParamsFromServer(
      { host: "203.0.113.20", port: 22, username: "root", connectionType: "PASSWORD", sshKeyId: "stale-key", password: "plain-password" },
      { privateKey: "plain-private-key" },
    );
    expect(passwordParams.password).toBe("plain-password");
    expect(passwordParams.privateKey).toBeUndefined();

    const keyParams = await buildSshParamsFromServer(
      { host: "203.0.113.21", port: 22, username: "root", connectionType: "SSH_KEY", sshKeyId: "key-1", password: "stale-password" },
      { privateKey: "plain-private-key" },
    );
    expect(keyParams.privateKey).toBe("plain-private-key");
    expect(keyParams.password).toBeUndefined();
  });
});
