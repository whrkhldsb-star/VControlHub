import { describe, expect, it } from "vitest";

import {
  buildRsyncCommand,
  buildTarSyncCommand,
  decryptSyncTargetCredentials,
  getSyncTempKeyPath,
  shellQuote,
} from "@/lib/sync/service";

describe("sync service command helpers", () => {
  it("quotes arbitrary shell values as a single POSIX token", () => {
    expect(shellQuote("simple")).toBe("'simple'");
    expect(shellQuote("a'b c; rm -rf /")).toBe("'a'\\''b c; rm -rf /'");
  });

  it("uses deterministic safe temporary key paths without exposing raw job ids", () => {
    expect(getSyncTempKeyPath("job/../../bad id", "rsync")).toBe("/tmp/app-sync-rsync-job_______bad_id");
  });

  it("builds rsync commands that use a pre-written key file and clean it up", () => {
    const command = buildRsyncCommand({
      flags: ["-avz", "--stats"],
      sourcePath: "/srv/source path/it's ok",
      targetPath: "/srv/target path",
      targetUser: "deploy",
      targetHost: "2001:db8::10",
      targetPort: 2222,
      keyPath: "/tmp/app-sync-rsync-job_1",
    });

    expect(command).toContain("trap 'rm -f -- ");
    expect(command).toContain("rsync -avz --stats");
    expect(command).toContain("ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -p 2222 -i ");
    expect(command).toContain("deploy@[2001:db8::10]:");
    expect(command).not.toContain("TEST_KEY_PLACEHOLDER");
  });

  it("builds tar fallback commands with key cleanup and optional target purge", () => {
    const command = buildTarSyncCommand({
      sourcePath: "/srv/source; nope",
      targetPath: "/srv/target path",
      targetUser: "root",
      targetHost: "example.com",
      targetPort: 22,
      keyPath: "/tmp/app-sync-tar-job_2",
      deleteOrphans: true,
    });

    expect(command).toContain("trap 'rm -f -- ");
    expect(command).toContain("find . -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +");
    expect(command).toContain("tar cf - -C ");
    expect(command).toContain("root@example.com");
    expect(command).not.toContain("TEST_KEY_PLACEHOLDER");
  });

  it("decrypts target credentials once before building remote sync commands", () => {
    const credentials = decryptSyncTargetCredentials({
      password: "enc:v1:password-ciphertext",
      sshKey: { privateKey: "enc:v1:key-ciphertext" },
    }, {
      decryptPassword: (value) => (value === "enc:v1:password-ciphertext" ? "plain-password" : value),
      decryptPrivateKey: (value) => (value === "enc:v1:key-ciphertext" ? "PRIVATE KEY" : value),
    });

    expect(credentials.password).toBe("plain-password");
    expect(credentials.privateKey).toBe("PRIVATE KEY");
  });
	it("rejects unsafe SSH users and hosts before building commands", () => {
		expect(() =>
			buildRsyncCommand({
				flags: ["-avz"],
				sourcePath: "/src",
				targetPath: "/dst",
				targetUser: "deploy;rm -rf /",
				targetHost: "example.com",
				targetPort: 22,
			}),
		).toThrow("Unsafe SSH username");

		expect(() =>
			buildTarSyncCommand({
				sourcePath: "/src",
				targetPath: "/dst",
				targetUser: "root",
				targetHost: "-oProxyCommand=sh",
				targetPort: 22,
				deleteOrphans: false,
			}),
		).toThrow("Unsafe SSH host");
	});

	it("uses unbracketed IPv6 addresses for raw ssh tar fallback targets", () => {
		const command = buildTarSyncCommand({
			sourcePath: "/src",
			targetPath: "/dst",
			targetUser: "root",
			targetHost: "2001:db8::10",
			targetPort: 22,
			deleteOrphans: false,
		});

		expect(command).toContain("'root@2001:db8::10'");
		expect(command).not.toContain("root@[2001:db8::10]");
	});
	it("rejects invalid SSH ports before interpolation", () => {
		expect(() =>
			buildRsyncCommand({
				flags: ["-avz"],
				sourcePath: "/src",
				targetPath: "/dst",
				targetUser: "deploy",
				targetHost: "example.com",
				targetPort: 0,
			}),
		).toThrow("Unsafe SSH port");

		expect(() =>
			buildTarSyncCommand({
				sourcePath: "/src",
				targetPath: "/dst",
				targetUser: "deploy",
				targetHost: "example.com",
				targetPort: 65536,
				deleteOrphans: false,
			}),
		).toThrow("Unsafe SSH port");
	});
});
