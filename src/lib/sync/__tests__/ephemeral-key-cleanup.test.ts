import { utils } from "ssh2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How a sync run's source host logs in to its target, per target server
 * (sync/target-auth). In credential mode, the original way, the source gets the
 * target's own private key (or its password as SSHPASS='…') in /tmp for the
 * run. In one-time key mode it gets a key made for the run, whose
 * authorized_keys line on the target is removed however the run ends, and
 * never the target's own credential. SSH is mocked here and answers like a
 * working pair of servers; the scripts themselves run for real in
 * one-time-key.test.ts and one-time-key-e2e.test.ts.
 */

const TARGET_PASSWORD = "target-own-password-5b1d";
const TARGET_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nTARGET-OWN-KEY-9c2e\n-----END OPENSSH PRIVATE KEY-----\n";

const { prismaMock, jobState, platform } = vi.hoisted(() => ({
  prismaMock: {
    syncJob: { updateMany: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    syncLog: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
  jobState: { job: null as Record<string, unknown> | null },
  /** The platform setting sync.targetAuthDefault, and the decrypted stored credential of the target. */
  platform: { targetAuthDefault: "credential", reads: 0, targetCredentials: {} as { privateKey?: string; password?: string } },
}));
vi.mock("@/lib/auth/execution-actor", () => ({ executionRefusal: vi.fn(async () => null), loadExecutionActor: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async (key: string) => {
    if (key !== "sync.targetAuthDefault") throw new Error(`unexpected setting ${key}`);
    platform.reads += 1;
    return platform.targetAuthDefault;
  }),
}));
vi.mock("../service-credentials", () => ({ decryptSyncTargetCredentials: vi.fn(() => platform.targetCredentials) }));
vi.mock("../service-crud", () => ({
  getSyncJobForExecution: vi.fn(async () => jobState.job),
  assertSyncEndpointsWithinReach: vi.fn(async () => {}),
  assertDisjointSyncEndpoints: vi.fn(),
}));
vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

type Call = { host: string; command: string };
type Failure = { host: "source" | "target"; pattern: RegExp; nth?: number; drop?: boolean; stderr?: string; exitCode?: number };
const remote = {
  calls: [] as Call[],
  writes: [] as { host: string; remotePath: string; content: string }[],
  failures: [] as Failure[],
  failWrite: false,
  rsyncInstalled: true,
  onTransfer: null as null | (() => void),
};

const execRemoteCommand = vi.fn(async ({ host, command }: { host: string; command: string }) => {
  remote.calls.push({ host, command });
  for (const failure of remote.failures) {
    if (failure.host !== host || !failure.pattern.test(command)) continue;
    const seen = remote.calls.filter((call) => call.host === host && failure.pattern.test(call.command)).length;
    if (failure.nth && seen !== failure.nth) continue;
    if (failure.drop) throw new Error("Connection lost");
    return { stdout: "", stderr: failure.stderr ?? "injected failure", exitCode: failure.exitCode ?? 1 };
  }
  if (command.startsWith("which rsync")) return { stdout: remote.rsyncInstalled ? "/usr/bin/rsync\n" : "MISSING\n", stderr: "", exitCode: 0 };
  if (command.includes("VCH_SYNC_SOURCE=")) return { stdout: "VCH_SYNC_SOURCE=ready\n", stderr: "", exitCode: 0 };
  if (command.includes("VCH_SYNC_TARGET=")) return { stdout: "VCH_SYNC_TARGET=empty\n", stderr: "", exitCode: 0 };
  if (command.includes("echo VCH_SYNC_KEY_INSTALLED")) return { stdout: "VCH_SYNC_KEY_INSTALLED\n", stderr: "", exitCode: 0 };
  if (command.includes("echo VCH_SYNC_KEY_REVOKED")) return { stdout: "VCH_SYNC_KEY_REVOKED\n", stderr: "", exitCode: 0 };
  if (command.includes("'vch-sync hello'")) return { stdout: `VCH_SYNC_PEER=${host === "source" ? "203.0.113.10" : "203.0.113.20"}\n`, stderr: "", exitCode: 0 };
  if (command.startsWith("trap ")) {
    remote.onTransfer?.();
    return { stdout: "Number of regular files transferred: 3\n", stderr: "", exitCode: 0 };
  }
  return { stdout: "", stderr: "", exitCode: 0 };
});
const writeRemoteFile = vi.fn(async (input: { host: string; remotePath: string; content: string }) => {
  if (remote.failWrite) throw new Error("SFTP write failed");
  remote.writes.push({ host: input.host, remotePath: input.remotePath, content: String(input.content) });
});
vi.mock("@/lib/ssh/client", () => ({
  // The hub's own connections. The target's stored credential is used here,
  // for the hub's session to the target, and must go nowhere else.
  buildSshParamsFromServer: vi.fn(async (server: { id: string }) => server.id === "dst"
    ? { host: "target", port: 22, username: "backup", privateKey: TARGET_KEY, password: TARGET_PASSWORD }
    : { host: "source", port: 22, username: "root", password: "source-own-password" }),
  execRemoteCommand,
  writeRemoteFile,
}));

const { executeSyncJob, reclaimStaleRunningSyncJobs } = await import("../service-runtime");

function useJob(overrides: {
  syncType?: string;
  targetConnection?: "SSH_KEY" | "PASSWORD";
  /** Each server's own choice; undefined models a row read without the column (follows the platform). */
  targetAuth?: string;
  sourceAuth?: string;
} = {}) {
  const has = (key: "targetAuth" | "sourceAuth") => Object.prototype.hasOwnProperty.call(overrides, key);
  jobState.job = {
    id: "job-1",
    status: "IDLE",
    syncType: overrides.syncType ?? "ONE_WAY",
    createdBy: "u1",
    teamId: "team-1",
    sourceServerId: "src",
    targetServerId: "dst",
    sourceServer: {
      id: "src", name: "web", host: "203.0.113.10", port: 22, username: "root", connectionType: "PASSWORD", sshKey: null, hostKeySha256: null,
      syncTargetAuth: has("sourceAuth") ? overrides.sourceAuth : "one-time-key",
    },
    targetServer: {
      id: "dst",
      name: "backup",
      host: "203.0.113.20",
      port: 22,
      username: "backup",
      connectionType: overrides.targetConnection ?? "SSH_KEY",
      sshKey: overrides.targetConnection === "PASSWORD" ? null : { privateKey: "stored-ciphertext" },
      hostKeySha256: null,
      syncTargetAuth: has("targetAuth") ? overrides.targetAuth : "one-time-key",
    },
    sourcePath: "/data/a",
    targetPath: "/data/b",
    deleteOrphans: false,
    compress: false,
  };
}

const installs = (host = "target") => remote.calls.filter((call) => call.host === host && call.command.includes("echo VCH_SYNC_KEY_INSTALLED"));
const revocations = (host = "target") => remote.calls.filter((call) => call.host === host && call.command.includes("echo VCH_SYNC_KEY_REVOKED"));
const transfers = () => remote.calls.filter((call) => call.command.startsWith("trap "));
const indexOf = (call: Call | undefined) => (call ? remote.calls.indexOf(call) : -1);

/** The run id in the key line the hub installed (`vch-sync-ephemeral:job-1:<run>:<expiry>`). */
function installedRun(host = "target"): string {
  const match = /vch-sync-ephemeral:job-1:((?:fwd|rev)-[0-9a-f]+):\d+/.exec(installs(host)[0]?.command ?? "");
  if (!match) throw new Error(`no one-time key was installed on ${host}`);
  return match[1]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.syncJob.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.syncJob.update.mockResolvedValue({});
  prismaMock.syncJob.findMany.mockResolvedValue([]);
  prismaMock.syncLog.create.mockResolvedValue({ id: "log-1" });
  prismaMock.syncLog.update.mockResolvedValue({});
  prismaMock.syncLog.updateMany.mockResolvedValue({ count: 1 });
  remote.calls.length = 0;
  remote.writes.length = 0;
  remote.failures = [];
  remote.failWrite = false;
  remote.rsyncInstalled = true;
  remote.onTransfer = null;
  platform.targetAuthDefault = "credential";
  platform.reads = 0;
  platform.targetCredentials = { privateKey: TARGET_KEY };
  useJob();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("what the source host receives with a one-time key", () => {
  it.each([
    ["a key-based target, rsync", "SSH_KEY", true],
    ["a key-based target, tar fallback", "SSH_KEY", false],
    ["a password-only target, rsync", "PASSWORD", true],
  ] as const)("never includes the target's own credential: %s", async (_label, targetConnection, rsyncInstalled) => {
    useJob({ targetConnection });
    remote.rsyncInstalled = rsyncInstalled;

    const result = await executeSyncJob("job-1");

    expect(result.ok, result.errorMessage).toBe(true);
    const toSource = [
      ...remote.calls.filter((call) => call.host === "source").map((call) => call.command),
      ...remote.writes.filter((write) => write.host === "source").map((write) => write.content),
    ].join("\n");
    expect(toSource).not.toContain(TARGET_PASSWORD);
    expect(toSource).not.toContain("TARGET-OWN-KEY");
    expect(toSource).not.toMatch(/sshpass|SSHPASS/);
    // Neither does any file written anywhere.
    for (const write of remote.writes) {
      expect(write.content).not.toContain(TARGET_PASSWORD);
      expect(write.content).not.toContain("TARGET-OWN-KEY");
    }
  });

  it("is a key made for the run, whose public half is the line installed on the target", async () => {
    await executeSyncJob("job-1");

    const keyFile = remote.writes.find((write) => write.host === "source" && write.remotePath === "/tmp/app-sync-rsync-job-1-fwd-leg");
    expect(keyFile).toBeDefined();
    const parsed = utils.parseKey(keyFile!.content);
    if (parsed instanceof Error) throw parsed;
    const blob = (Array.isArray(parsed) ? parsed[0]! : parsed).getPublicSSH().toString("base64");
    const [first, pinned] = installs();
    expect(first!.command).toContain(`ssh-ed25519 ${blob} vch-sync-ephemeral:job-1:`);
    expect(first!.command).toContain("vch-sync-gate");
    // Re-added with from= the address the target saw the source connect from.
    expect(pinned!.command).toContain(`ssh-ed25519 ${blob} `);
    expect(pinned!.command).toContain('from=\\"203.0.113.10\\"');
    // A second run gets a different key.
    remote.writes.length = 0;
    await executeSyncJob("job-1");
    expect(remote.writes.find((write) => write.remotePath === "/tmp/app-sync-rsync-job-1-fwd-leg")!.content).not.toBe(keyFile!.content);
  });
});

describe("the one-time key line on the target", () => {
  it("is removed after a successful run, once the transfer is over", async () => {
    const result = await executeSyncJob("job-1");

    expect(result.ok, result.errorMessage).toBe(true);
    const run = installedRun();
    expect(revocations()).toHaveLength(1);
    expect(revocations()[0]!.command).toContain(`vch_filter 'job-1' '${run}'`);
    expect(indexOf(revocations()[0])).toBeGreaterThan(indexOf(transfers()[0]));
    // And the private half is removed from the source by the hub too, not only by the command's trap.
    const cleanup = remote.calls.filter((call) => call.host === "source" && call.command.startsWith("rm -f -- ") && call.command.includes("/tmp/app-sync-rsync-job-1-fwd-leg") && !call.command.includes("umask"));
    expect(cleanup).toHaveLength(1);
  });

  it.each<[string, () => void, { transferRan: boolean; message?: RegExp }]>([
    ["adding it fails", () => { remote.failures = [{ host: "target", pattern: /VCH_SYNC_KEY_INSTALLED/, nth: 1 }]; }, { transferRan: false, message: /Could not add the one-time sync key/ }],
    ["the session drops while adding it", () => { remote.failures = [{ host: "target", pattern: /VCH_SYNC_KEY_INSTALLED/, nth: 1, drop: true }]; }, { transferRan: false }],
    ["writing the private half to the source fails", () => { remote.failWrite = true; }, { transferRan: false }],
    ["the target refuses the key", () => { remote.failures = [{ host: "source", pattern: /'vch-sync hello'/, stderr: "Permission denied (publickey).", exitCode: 255 }]; }, { transferRan: false, message: /did not accept the one-time sync key[\s\S]*public-key login/ }],
    ["something other than the gate answers", () => { remote.failures = [{ host: "source", pattern: /'vch-sync hello'/, stderr: "", exitCode: 0 }]; }, { transferRan: false, message: /did not accept the one-time sync key/ }],
    ["pinning the source address fails", () => { remote.failures = [{ host: "target", pattern: /VCH_SYNC_KEY_INSTALLED/, nth: 2 }]; }, { transferRan: false }],
    ["the transfer fails", () => { remote.failures = [{ host: "source", pattern: /^trap /, stderr: "rsync error: some files could not be transferred", exitCode: 23 }]; }, { transferRan: true, message: /rsync failed \(exit 23\)/ }],
    ["the transfer's session drops", () => { remote.failures = [{ host: "source", pattern: /^trap /, drop: true }]; }, { transferRan: true }],
  ])("is removed when %s", async (_label, arrange, expected) => {
    arrange();

    const result = await executeSyncJob("job-1");

    expect(result.ok).toBe(false);
    if (expected.message) expect(result.errorMessage).toMatch(expected.message);
    expect(transfers().length > 0).toBe(expected.transferRan);
    const run = installedRun();
    expect(revocations()).toHaveLength(1);
    expect(revocations()[0]!.command).toContain(`vch_filter 'job-1' '${run}'`);
    expect(indexOf(revocations()[0])).toBeGreaterThan(indexOf(installs().at(-1)));
  });

  it("is not installed at all when the run stops before choosing a transport", async () => {
    remote.failures = [{ host: "source", pattern: /VCH_SYNC_SOURCE=/, stderr: "no such directory" }];

    const result = await executeSyncJob("job-1");

    expect(result.ok).toBe(false);
    expect(installs()).toHaveLength(0);
    expect(remote.writes).toHaveLength(0);
  });

  it("is still removed when the source host cannot be reached for its own cleanup", async () => {
    // The hub's own removal of the key file (not its creation, which also starts with rm -f).
    remote.failures = [{ host: "source", pattern: /^trap /, drop: true }, { host: "source", pattern: /^rm -f -- '\/tmp\/app-sync-rsync[^&]*$/, drop: true }];

    const result = await executeSyncJob("job-1");

    expect(result.ok).toBe(false);
    expect(revocations()).toHaveLength(1);
  });
});

describe("a target that only takes a password, set to a one-time key", () => {
  it("fails with an error that says why and how to go back, instead of copying the password to the source", async () => {
    useJob({ targetConnection: "PASSWORD" });
    remote.failures = [{ host: "source", pattern: /'vch-sync hello'/, stderr: "Permission denied (password).", exitCode: 255 }];

    const result = await executeSyncJob("job-1");

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/backup \(backup@203\.0\.113\.20:22\) did not accept the one-time sync key/);
    expect(result.errorMessage).toMatch(/must allow public-key login/);
    expect(result.errorMessage).toMatch(/VControlHub itself logs in to this target with a password/);
    expect(result.errorMessage).toMatch(/To hand the target's own password to the source for the run instead, the original way, set this server's sync login to "Original"/);
    expect(transfers()).toHaveLength(0);
    expect(revocations()).toHaveLength(1);
    const toSource = remote.calls.filter((call) => call.host === "source").map((call) => call.command).join("\n");
    expect(toSource).not.toContain(TARGET_PASSWORD);
    expect(toSource).not.toMatch(/sshpass|SSHPASS/);
  });
});

describe("bidirectional jobs", () => {
  it("give each leg its own key on the host it writes to, and remove both", async () => {
    useJob({ syncType: "BIDIRECTIONAL" });

    const result = await executeSyncJob("job-1");

    expect(result.ok, result.errorMessage).toBe(true);
    // Forward leg: key on the target, private half on the source; reverse: the other way round.
    expect(installedRun("target")).toMatch(/^fwd-/);
    expect(installedRun("source")).toMatch(/^rev-/);
    expect(remote.writes.map((write) => `${write.host}:${write.remotePath}`)).toEqual([
      "source:/tmp/app-sync-rsync-job-1-fwd-leg",
      "target:/tmp/app-sync-rsync-job-1-rev-leg",
    ]);
    expect(revocations("target")).toHaveLength(1);
    expect(revocations("source")).toHaveLength(1);
    // The reverse leg starts only after the forward key is gone.
    expect(indexOf(revocations("target")[0])).toBeLessThan(indexOf(installs("source")[0]));
    // The source's own password never travels to the target either.
    const toTarget = remote.calls.filter((call) => call.host === "target").map((call) => call.command).join("\n");
    expect(toTarget).not.toContain("source-own-password");
  });
});

describe("runs that died", () => {
  it("have their keys and key files removed on both servers by the stale-run reclaim", async () => {
    prismaMock.syncJob.findMany.mockResolvedValueOnce([{ id: "job-1" }]);

    const reclaimed = await reclaimStaleRunningSyncJobs();

    expect(reclaimed).toEqual(["job-1"]);
    for (const host of ["source", "target"]) {
      const [sweep] = revocations(host);
      expect(sweep, host).toBeDefined();
      expect(sweep!.command).toContain("vch_filter 'job-1' ''");
      for (const leg of ["fwd", "rev"]) {
        for (const purpose of ["rsync", "tar", "env", "known_hosts"]) {
          expect(sweep!.command).toContain(`'/tmp/app-sync-${purpose}-job-1-${leg}-leg'`);
        }
      }
    }
  });

  it("does not stop the reclaim when a server cannot be reached", async () => {
    prismaMock.syncJob.findMany.mockResolvedValueOnce([{ id: "job-1" }]);
    remote.failures = [{ host: "target", pattern: /VCH_SYNC_KEY_REVOKED/, drop: true }];

    await expect(reclaimStaleRunningSyncJobs()).resolves.toEqual(["job-1"]);
    expect(revocations("source")).toHaveLength(1);
  });

  it("are not mistaken for live ones: a long transfer keeps the job's own row fresh", async () => {
    // The heartbeat used to touch "<job>-fwd", which matched no row, so the
    // reclaim took every run over 30 minutes for dead (and would now revoke its key).
    vi.useFakeTimers();
    remote.onTransfer = () => vi.advanceTimersByTime(5 * 60 * 1000);

    await executeSyncJob("job-1");

    expect(prismaMock.syncJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "RUNNING" },
      data: { updatedAt: expect.any(Date) },
    });
  });
});

describe("credential mode (the original way)", () => {
  const keyFile = "/tmp/app-sync-rsync-job-1-fwd-leg";

  it("hands the target's own key to the source for the run, then removes it", async () => {
    useJob({ targetAuth: "credential" });

    const result = await executeSyncJob("job-1");

    expect(result.ok, result.errorMessage).toBe(true);
    expect(remote.writes).toEqual([{ host: "source", remotePath: keyFile, content: TARGET_KEY }]);
    expect(installs()).toHaveLength(0);
    expect(revocations()).toHaveLength(0);
    const [transfer] = transfers();
    // The source names the target path itself, kept out of the target's shell by -s.
    expect(transfer!.command).toContain(" -s -e ");
    expect(transfer!.command).toContain("'backup@203.0.113.20:/data/b/'");
    expect(transfer!.command).toContain(`-i ${keyFile}`);
    const cleanup = remote.calls.filter((call) => call.host === "source" && call.command === `rm -f -- '${keyFile}'`);
    expect(cleanup).toHaveLength(1);
    expect(indexOf(cleanup[0])).toBeGreaterThan(indexOf(transfer));
  });

  it("hands a password-only target's password to the source as an SSHPASS file, then removes it", async () => {
    useJob({ targetAuth: "credential", targetConnection: "PASSWORD" });
    platform.targetCredentials = { password: TARGET_PASSWORD };

    const result = await executeSyncJob("job-1");

    expect(result.ok, result.errorMessage).toBe(true);
    expect(remote.writes).toEqual([{ host: "source", remotePath: "/tmp/app-sync-env-job-1-fwd-leg", content: `SSHPASS='${TARGET_PASSWORD}'\n` }]);
    expect(transfers()[0]!.command).toContain("sshpass -e ssh ");
    expect(transfers()[0]!.command).not.toContain(TARGET_PASSWORD);
  });

  it("removes the target's key from the source when the transfer fails", async () => {
    useJob({ targetAuth: "credential" });
    remote.failures = [{ host: "source", pattern: /^trap /, drop: true }];

    const result = await executeSyncJob("job-1");

    expect(result.ok).toBe(false);
    expect(remote.calls.filter((call) => call.host === "source" && call.command === `rm -f -- '${keyFile}'`)).toHaveLength(1);
  });

  it("still stops before anything runs when the target has no credential stored", async () => {
    useJob({ targetAuth: "credential" });
    platform.targetCredentials = {};

    const result = await executeSyncJob("job-1");

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Target server has no SSH key or password configured");
    expect(remote.calls).toEqual([]);
  });
});

describe("choosing the mode", () => {
  it("follows the platform setting for a server that follows it, reading it once", async () => {
    useJob({ targetAuth: "inherit", syncType: "BIDIRECTIONAL", sourceAuth: "inherit" });
    platform.targetAuthDefault = "one-time-key";

    const result = await executeSyncJob("job-1");

    expect(result.ok, result.errorMessage).toBe(true);
    expect(installs("target")).toHaveLength(2);
    expect(installs("source")).toHaveLength(2);
    expect(platform.reads).toBe(1);
  });

  it("uses the original way for a server that follows a platform setting left at its default", async () => {
    useJob({ targetAuth: "inherit" });

    await executeSyncJob("job-1");

    expect(installs()).toHaveLength(0);
    expect(remote.writes.map((write) => write.content)).toEqual([TARGET_KEY]);
  });

  it("treats a row without the column like one that follows the platform setting", async () => {
    useJob({ targetAuth: undefined });
    platform.targetAuthDefault = "one-time-key";

    await executeSyncJob("job-1");

    expect(installs()).toHaveLength(2);
  });

  it.each([
    ["credential", "one-time-key", 0],
    ["one-time-key", "credential", 2],
  ] as const)("lets a server's own choice (%s) win over the platform setting (%s)", async (own, platformValue, installCount) => {
    useJob({ targetAuth: own });
    platform.targetAuthDefault = platformValue;

    await executeSyncJob("job-1");

    expect(installs()).toHaveLength(installCount);
    expect(platform.reads).toBe(0);
  });

  it("decides each leg of a bidirectional job by the server that leg writes to", async () => {
    // Forward writes to the job's target (original way); reverse writes to the job's source (one-time key).
    useJob({ syncType: "BIDIRECTIONAL", targetAuth: "credential", sourceAuth: "one-time-key" });

    const result = await executeSyncJob("job-1");

    expect(result.ok, result.errorMessage).toBe(true);
    expect(remote.writes.find((write) => write.host === "source")!.content).toBe(TARGET_KEY);
    expect(installs("target")).toHaveLength(0);
    expect(installs("source")).toHaveLength(2);
    expect(revocations("source")).toHaveLength(1);
    // The reverse leg's source (the job's target) gets only a one-time key, never the job source's credential.
    expect(remote.writes.find((write) => write.host === "target")!.content).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----/);
    expect(remote.writes.find((write) => write.host === "target")!.content).not.toBe(TARGET_KEY);
  });

  it("refuses to guess when the platform setting holds an unknown value", async () => {
    useJob({ targetAuth: "inherit" });
    platform.targetAuthDefault = "sometimes";

    const result = await executeSyncJob("job-1");

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/sync\.targetAuthDefault holds "sometimes"/);
    expect(remote.calls).toEqual([]);
  });
});
