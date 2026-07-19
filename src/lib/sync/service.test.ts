import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    syncJob: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    server: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  assertSyncRemoteSucceeded,
  buildRsyncCommand,
  buildTarSyncCommand,
  createSyncJob,
  decryptSyncTargetCredentials,
  getSyncTempKeyPath,
  listSyncJobs,
  shellQuote,
} from "@/lib/sync/service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sync job listing", () => {
  it("bounds SyncJob list queries so task-center style surfaces cannot hydrate unbounded rows", async () => {
    prismaMock.syncJob.findMany.mockResolvedValueOnce([]);

    await listSyncJobs();

    expect(prismaMock.syncJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: "desc" },
      take: 200,
    }));
  });
});

describe("createSyncJob team scope", () => {
  const baseInput = {
    name: "team-sync",
    sourceServerId: "srv-a",
    sourcePath: "/data/a",
    targetServerId: "srv-b",
    targetPath: "/data/b",
    session: {
      userId: "u1",
      roles: ["operator"] as ("operator")[],
      currentTeamId: "team-1",
    },
  };

  it("rejects source/target servers outside the caller's teamWhere", async () => {
    prismaMock.server.findMany.mockResolvedValueOnce([{ id: "srv-a" }]); // missing srv-b

    await expect(createSyncJob(baseInput)).rejects.toThrow(
      /outside your team scope|not found/,
    );
    expect(prismaMock.syncJob.create).not.toHaveBeenCalled();
    expect(prismaMock.server.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["srv-a", "srv-b"] },
          OR: [{ teamId: "team-1" }, { teamId: null }],
        }),
      }),
    );
  });

  it("stamps teamId and creates when both servers are in scope", async () => {
    prismaMock.server.findMany.mockResolvedValueOnce([{ id: "srv-a" }, { id: "srv-b" }]);
    prismaMock.syncJob.create.mockResolvedValueOnce({
      id: "job-1",
      ...baseInput,
      teamId: "team-1",
      sourceServer: { id: "srv-a", name: "A", host: "a" },
      targetServer: { id: "srv-b", name: "B", host: "b" },
    });

    const job = await createSyncJob(baseInput);

    expect(job.id).toBe("job-1");
    expect(prismaMock.syncJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceServerId: "srv-a",
          targetServerId: "srv-b",
          teamId: "team-1",
          createdBy: "u1",
        }),
      }),
    );
  });
});

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
    expect(command).toContain("ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile='/dev/null' -p 2222 -i ");
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

	it("uses the exact pinned known_hosts file for the real rsync and tar SSH connection", () => {
		const common = {
			sourcePath: "/src", targetPath: "/dst", targetUser: "deploy", targetHost: "example.com", targetPort: 2222,
			hostKeySha256: "SHA256:abc", jobId: "job-1",
		};
		const rsync = buildRsyncCommand({ ...common, flags: ["-avz"] });
		const tar = buildTarSyncCommand({ ...common, deleteOrphans: false });
		for (const command of [rsync, tar]) {
			expect(command).toContain("StrictHostKeyChecking=yes");
			expect(command).toContain("UserKnownHostsFile='/tmp/app-sync-known_hosts-job-1'");
			expect(command).not.toContain("StrictHostKeyChecking=accept-new");
			expect(command).toContain("/tmp/app-sync-known_hosts-job-1");
		}
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

describe("assertSyncRemoteSucceeded", () => {
	it("allows exit 0 only", () => {
		expect(() =>
			assertSyncRemoteSucceeded({ stdout: "ok", stderr: "", exitCode: 0 }, "rsync"),
		).not.toThrow();
	});

	it("throws on null exitCode (SSH status missing — false-success guard)", () => {
		expect(() =>
			assertSyncRemoteSucceeded({ stdout: "", stderr: "broken pipe", exitCode: null }, "rsync"),
		).toThrow(/rsync failed \(SSH connection\/status missing\).*broken pipe/);
		expect(() =>
			assertSyncRemoteSucceeded({ stdout: "", stderr: "", exitCode: null }, "tar sync"),
		).toThrow(/tar sync failed \(SSH connection\/status missing\)/);
	});

	it("throws on non-zero exit with stderr/stdout detail (false-success guard)", () => {
		expect(() =>
			assertSyncRemoteSucceeded(
				{ stdout: "rsync error: some files vanished", stderr: "", exitCode: 23 },
				"rsync",
			),
		).toThrow(/rsync failed \(exit 23\).*vanished/);

		expect(() =>
			assertSyncRemoteSucceeded(
				{ stdout: "", stderr: "Permission denied", exitCode: 1 },
				"tar sync",
			),
		).toThrow(/tar sync failed \(exit 1\).*Permission denied/);
	});
});
