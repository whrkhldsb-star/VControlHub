import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    syncJob: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    server: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  buildRsyncCommand,
  buildSyncGateScript,
  buildTarSyncCommand,
  getSyncTempKeyPath,
  shellQuote,
} from "@/lib/sync/service-commands";
import {
  createSyncJob,
  getSyncJob,
  getSyncJobForExecution,
  listSyncJobs,
  updateSyncJob,
} from "@/lib/sync/service-crud";
import { assertSyncRemoteSucceeded } from "@/lib/sync/service-runtime";

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

describe("sync job team scope", () => {
  it("quarantines null-team jobs from a caller with no current team", async () => {
    // A sync job hydrates both servers with their SSH keys and can be executed
    // on demand, so a null teamId is legacy data only a global manager may read.
    prismaMock.syncJob.findMany.mockResolvedValueOnce([]);

    await listSyncJobs({ userId: "u1", roles: ["operator"], currentTeamId: null });

    expect(prismaMock.syncJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "__unassigned_sync_jobs_require_team_manage__" },
      }),
    );
  });

  it("scopes list queries to the caller's current team", async () => {
    prismaMock.syncJob.findMany.mockResolvedValueOnce([]);

    await listSyncJobs({ userId: "u1", roles: ["operator"], currentTeamId: "team-1" });

    expect(prismaMock.syncJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teamId: "team-1" } }),
    );
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

  it("rejects source/target servers outside the caller's explicit team", async () => {
    prismaMock.server.findMany.mockResolvedValueOnce([{ id: "srv-a" }]); // missing srv-b

    await expect(createSyncJob(baseInput)).rejects.toThrow(
      /outside your team scope|not found/,
    );
    expect(prismaMock.syncJob.create).not.toHaveBeenCalled();
    expect(prismaMock.server.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["srv-a", "srv-b"] },
          AND: expect.arrayContaining([{ teamId: "team-1" }]),
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

  it("rejects identical source/target server+path endpoints", async () => {
    await expect(
      createSyncJob({
        ...baseInput,
        sourceServerId: "srv-a",
        targetServerId: "srv-a",
        sourcePath: "/data/share/",
        targetPath: "/data/share",
      }),
    ).rejects.toThrow(/不能相同|must differ/i);
    expect(prismaMock.server.findMany).not.toHaveBeenCalled();
    expect(prismaMock.syncJob.create).not.toHaveBeenCalled();
  });
});

describe("updateSyncJob ownership CAS", () => {
  it("pins the original teamId in the atomic update", async () => {
    const existing = {
      id: "job-1",
      teamId: "team-1",
      syncType: "MIRROR",
      deleteOrphans: false,
      sourceServerId: "srv-a",
      targetServerId: "srv-b",
      sourcePath: "/data/source",
      targetPath: "/data/target",
    };
    prismaMock.syncJob.findFirst
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, name: "renamed" });
    // The editor reaches both of the job's servers.
    prismaMock.server.findMany.mockResolvedValueOnce([{ id: "srv-a" }, { id: "srv-b" }]);
    prismaMock.syncJob.updateMany.mockResolvedValueOnce({ count: 1 });

    await updateSyncJob(
      "job-1",
      { name: "renamed" },
      { userId: "u1", roles: ["operator"], currentTeamId: "team-1" },
    );

    expect(prismaMock.syncJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1", teamId: "team-1" },
        data: { name: "renamed" },
      }),
    );
  });

  it("returns NotFound when ownership changes before the atomic update", async () => {
    prismaMock.syncJob.findFirst.mockResolvedValueOnce({
      id: "job-1",
      teamId: "team-1",
      syncType: "MIRROR",
      deleteOrphans: false,
      sourceServerId: "srv-a",
      targetServerId: "srv-b",
      sourcePath: "/data/source",
      targetPath: "/data/target",
    });
    prismaMock.server.findMany.mockResolvedValueOnce([{ id: "srv-a" }, { id: "srv-b" }]);
    prismaMock.syncJob.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(updateSyncJob(
      "job-1",
      { name: "renamed" },
      { userId: "u1", roles: ["operator"], currentTeamId: "team-1" },
    )).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
  });

  it("refuses a patch that collapses both endpoints onto the same path", async () => {
    // createSyncJob rejects this shape; a PATCH must not be a way around it. On
    // one server with the same path and deleteOrphans, the tar fallback wipes the
    // target directory while `tar cf -` is still streaming from it.
    prismaMock.syncJob.findFirst.mockResolvedValueOnce({
      id: "job-1",
      teamId: "team-1",
      syncType: "MIRROR",
      deleteOrphans: true,
      sourceServerId: "srv-a",
      targetServerId: "srv-a",
      sourcePath: "/data/source",
      targetPath: "/data/target",
    });
    prismaMock.server.findMany.mockResolvedValueOnce([{ id: "srv-a" }]);

    await expect(updateSyncJob(
      "job-1",
      { targetPath: "/data/source/" },
      { userId: "u1", roles: ["operator"], currentTeamId: "team-1" },
    )).rejects.toMatchObject({ name: "ValidationError", status: 400 });
    expect(prismaMock.syncJob.updateMany).not.toHaveBeenCalled();
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
      targetUser: "deploy",
      targetHost: "2001:db8::10",
      targetPort: 2222,
      keyPath: "/tmp/app-sync-rsync-job_1",
    });

    expect(command).toContain("trap 'rm -f -- ");
    expect(command).toContain("unset RSYNC_PROTECT_ARGS; rsync -avz --stats -e ");
    // rsync splits -e on whitespace and execs it, so nothing inside may be
    // shell-quoted: `-i '/tmp/k'` would reach ssh with the quotes attached and
    // the key would be ignored ("Identity file not accessible"). Only that key
    // is offered, never the source user's own keys or agent.
    expect(command).toContain(
      '-e "ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o BatchMode=yes -p 2222 -o IdentitiesOnly=yes -i /tmp/app-sync-rsync-job_1"',
    );
    expect(command).toContain("'deploy@[2001:db8::10]:.'");
    expect(command).not.toContain("TEST_KEY_PLACEHOLDER");
  });

  it("never carries a password to the source host", () => {
    // Sync used to write the target's password to the source as SSHPASS='…'
    // and run sshpass there; the source now only ever gets a one-time key.
    const rsync = buildRsyncCommand({ flags: ["-avz"], sourcePath: "/src", targetUser: "deploy", targetHost: "example.com", targetPort: 22, keyPath: "/tmp/app-sync-rsync-job1" });
    const tar = buildTarSyncCommand({ sourcePath: "/src", targetUser: "deploy", targetHost: "example.com", targetPort: 22, keyPath: "/tmp/app-sync-tar-job1" });
    for (const command of [rsync, tar]) {
      expect(command).not.toMatch(/sshpass|SSHPASS/);
    }
  });

  it("refuses a transport path that rsync could not carry unquoted", () => {
    expect(() =>
      buildRsyncCommand({
        flags: ["-avz"],
        sourcePath: "/src",
        targetUser: "deploy",
        targetHost: "example.com",
        targetPort: 22,
        keyPath: "/tmp/key'; rm -rf /",
      }),
    ).toThrow("不安全的 SSH 传输路径");
  });

  it("builds tar fallback commands with key cleanup that only name the gate's phases on the target", () => {
    const command = buildTarSyncCommand({
      sourcePath: "/srv/source; nope",
      targetUser: "root",
      targetHost: "example.com",
      targetPort: 22,
      keyPath: "/tmp/app-sync-tar-job_2",
    });

    expect(command).toContain("trap 'rm -f -- ");
    // Behaviour (staging, status propagation, untouched target on failure) is
    // exercised on real files in __tests__/tar-sync-fault-injection.test.ts.
    expect(command).toContain("tar cf - -C '/srv/source; nope' .");
    expect(command).toContain("'root@example.com' 'vch-sync tar-receive'");
    expect(command).toContain("'root@example.com' 'vch-sync tar-commit'");
    expect(command).toContain("'root@example.com' 'vch-sync tar-abort'");
    // What happens on the target is fixed in the key's gate, not sent from here.
    expect(command).not.toContain(".vch-sync-");
    expect(command).not.toContain("TEST_KEY_PLACEHOLDER");
  });

  it("ends the rsync options before the paths, and keeps a relative source from being read as an option or a host", () => {
    // A source such as "--rsync-path=..." or "evil.example:/data" made the source host run a command or connect out.
    const build = (sourcePath: string) => buildRsyncCommand({
      flags: ["-av"],
      sourcePath,
      targetUser: "deploy",
      targetHost: "example.com",
      targetPort: 22,
      keyPath: "/tmp/app-sync-rsync-job_1",
    });
    expect(build("/srv/source")).toContain(" -- '/srv/source/' 'deploy@example.com:.'");
    expect(build("--rsync-path=/bin/sh -c id")).toContain(" -- './--rsync-path=/bin/sh -c id/' ");
    expect(build("evil.example:/data")).toContain(" -- './evil.example:/data/' ");
  });

  it("keeps a hostile target path out of every shell: the gate holds it as one quoted word", () => {
    const hostile = "/tmp/x;id>/tmp/pwned;$(touch /tmp/pwned)";
    // The source never names the target path; the gate fixes the destination.
    // Its behaviour is exercised in __tests__/one-time-key.test.ts.
    const gate = buildSyncGateScript({ mode: "rsync", targetPath: hostile, allowDelete: false });
    expect(gate).toContain(`exec rsync --server $vch_opts . ${shellQuote(`${hostile}/`)}`);
    const tarGate = buildSyncGateScript({ mode: "tar", targetPath: hostile, allowDelete: true, jobId: "job-1" });
    expect(tarGate).toContain(shellQuote(hostile));
    expect(tarGate).toContain(".vch-sync-prev-job-1");
  });

  it("uses the exact pinned known_hosts file for the real rsync and tar SSH connection", () => {
    const common = {
      sourcePath: "/src", targetUser: "deploy", targetHost: "example.com", targetPort: 2222,
      hostKeySha256: "SHA256:abc", jobId: "job-1",
    };
    const rsync = buildRsyncCommand({ ...common, flags: ["-avz"] });
    const tar = buildTarSyncCommand(common);
    for (const command of [rsync, tar]) {
      expect(command).toContain("StrictHostKeyChecking=yes");
      expect(command).not.toContain("StrictHostKeyChecking=accept-new");
      expect(command).toContain("/tmp/app-sync-known_hosts-job-1");
    }
    // rsync hands the -e tokens straight to ssh: a quoted file name would be
    // missing, and StrictHostKeyChecking=yes then aborts the whole transfer.
    expect(rsync).toContain("UserKnownHostsFile=/tmp/app-sync-known_hosts-job-1 ");
    expect(rsync).not.toContain("UserKnownHostsFile='");
    // The tar fallback is read by a remote shell, which consumes the quotes.
    expect(tar).toContain("UserKnownHostsFile='/tmp/app-sync-known_hosts-job-1'");
  });

  it("rejects unsafe SSH users and hosts before building commands", () => {
    expect(() =>
      buildRsyncCommand({
        flags: ["-avz"],
        sourcePath: "/src",
        targetUser: "deploy;rm -rf /",
        targetHost: "example.com",
        targetPort: 22,
      }),
    ).toThrow("不安全的 SSH 用户名");

    expect(() =>
      buildTarSyncCommand({
        sourcePath: "/src",
        targetUser: "root",
        targetHost: "-oProxyCommand=sh",
        targetPort: 22,
      }),
    ).toThrow("不安全的 SSH 主机");
  });

  it("uses unbracketed IPv6 addresses for raw ssh tar fallback targets", () => {
    const command = buildTarSyncCommand({
      sourcePath: "/src",
      targetUser: "root",
      targetHost: "2001:db8::10",
      targetPort: 22,
    });

    expect(command).toContain("'root@2001:db8::10'");
    expect(command).not.toContain("root@[2001:db8::10]");
  });
  it("rejects invalid SSH ports before interpolation", () => {
    expect(() =>
      buildRsyncCommand({
        flags: ["-avz"],
        sourcePath: "/src",
        targetUser: "deploy",
        targetHost: "example.com",
        targetPort: 0,
      }),
    ).toThrow("不安全的 SSH 端口");

    expect(() =>
      buildTarSyncCommand({
        sourcePath: "/src",
        targetUser: "deploy",
        targetHost: "example.com",
        targetPort: 65536,
      }),
    ).toThrow("不安全的 SSH 端口");
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

describe("sync job credential boundary", () => {
  it("keeps the SSH key out of the row three HTTP routes hand back", async () => {
    prismaMock.syncJob.findFirst.mockResolvedValueOnce(null);

    await getSyncJob("job-1");

    const args = prismaMock.syncJob.findFirst.mock.calls[0]![0] as {
      include: { sourceServer: unknown; targetServer: unknown };
    };
    // `include: { sshKey: true }` here put the stored private key one
    // `NextResponse.json(job)` away from the browser.
    for (const endpoint of [args.include.sourceServer, args.include.targetServer]) {
      expect(endpoint).toEqual({
        select: { id: true, name: true, host: true, username: true },
      });
    }
    expect(JSON.stringify(args.include)).not.toContain("sshKey");
  });

  it("still loads credentials for the execution path", async () => {
    prismaMock.syncJob.findFirst.mockResolvedValueOnce(null);

    await getSyncJobForExecution("job-1");

    expect(prismaMock.syncJob.findFirst).toHaveBeenCalledWith({
      where: { id: "job-1" },
      include: {
        sourceServer: { include: { sshKey: true } },
        targetServer: { include: { sshKey: true } },
      },
    });
  });
});
