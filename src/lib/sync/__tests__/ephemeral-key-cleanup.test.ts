import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The target's private key is written to the source host for the ssh client
 * that rsync (or the tar fallback) runs there; the command's own trap removes
 * it once the command runs. A sync that failed before that — the session
 * dropped while the command was being started — left the key in the source
 * host's /tmp.
 */

const prismaMock = {
  syncJob: { updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({})) },
  syncLog: { create: vi.fn(async () => ({ id: "log-1" })), update: vi.fn(async () => ({})) },
};
vi.mock("@/lib/auth/execution-actor", () => ({ executionRefusal: vi.fn(async () => null), loadExecutionActor: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("../service-crud", () => ({
  getSyncJobForExecution: vi.fn(async () => ({
    id: "job-1",
    syncType: "one-way",
    sourceServer: { sshKey: null },
    targetServer: { host: "203.0.113.20", port: 22, username: "backup", sshKey: { privateKey: "stored" }, hostKeySha256: null },
    sourcePath: "/data/a",
    targetPath: "/data/b",
    deleteOrphans: false,
    compress: false,
  })),
  assertSyncEndpointsWithinReach: vi.fn(async () => {}), assertDisjointSyncEndpoints: vi.fn(),
}));
vi.mock("../service-credentials", () => ({ decryptSyncTargetCredentials: () => ({ privateKey: "TARGET PRIVATE KEY" }) }));
vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const remote = { commands: [] as string[], rsyncInstalled: true, dropOn: null as RegExp | null };
const execRemoteCommand = vi.fn(async ({ command }: { command: string }) => {
  remote.commands.push(command);
  if (remote.dropOn?.test(command)) throw new Error("Connection lost before the command started");
  if (command.startsWith("which rsync")) return { stdout: remote.rsyncInstalled ? "/usr/bin/rsync\n" : "MISSING\n", stderr: "", exitCode: 0 };
  if (command.includes("VCH_SYNC_SOURCE=")) return { stdout: "VCH_SYNC_SOURCE=ready\n", stderr: "", exitCode: 0 };
  if (command.includes("VCH_SYNC_TARGET=")) return { stdout: "VCH_SYNC_TARGET=empty\n", stderr: "", exitCode: 0 };
  return { stdout: "", stderr: "", exitCode: 0 };
});
const writeRemoteFile = vi.fn(async (_input: { remotePath: string; content: string }) => undefined);
vi.mock("@/lib/ssh/client", () => ({
  buildSshParamsFromServer: vi.fn(async () => ({ host: "203.0.113.10", port: 22, username: "root", password: "source" })),
  execRemoteCommand,
  writeRemoteFile,
}));

const { executeSyncJob } = await import("../service-runtime");

/** Where the target key was written on the source host. */
function writtenKeyPath(): string {
  const path = writeRemoteFile.mock.calls.find(([input]) => input.content === "TARGET PRIVATE KEY")?.[0].remotePath;
  if (!path) throw new Error("the key was never written");
  return path;
}

/** Removals of `path` that are not part of writing it (which also starts with rm -f). */
function removalsOf(path: string) {
  return remote.commands.filter((command) => command.startsWith("rm -f -- ") && !command.includes("umask") && command.includes(path));
}

beforeEach(() => {
  vi.clearAllMocks();
  remote.commands.length = 0;
  remote.rsyncInstalled = true;
  remote.dropOn = null;
});

describe("the target key written to the source host", () => {
  it("is removed when the rsync command never ran", async () => {
    remote.dropOn = /^trap /;

    const result = await executeSyncJob("job-1");

    expect(result.ok).toBe(false);
    expect(writtenKeyPath()).toMatch(/^\/tmp\/app-sync-rsync-/);
    expect(removalsOf(writtenKeyPath())).toHaveLength(1);
  });

  it("is removed when the tar fallback never ran", async () => {
    remote.rsyncInstalled = false;
    remote.dropOn = /^trap /;

    const result = await executeSyncJob("job-1");

    expect(result.ok).toBe(false);
    expect(writtenKeyPath()).toMatch(/^\/tmp\/app-sync-tar-/);
    expect(removalsOf(writtenKeyPath())).toHaveLength(1);
  });

  it("is removed when writing it failed part-way", async () => {
    remote.dropOn = /^chmod 600 -- /;

    const result = await executeSyncJob("job-1");

    expect(result.ok).toBe(false);
    expect(removalsOf(writtenKeyPath())).toHaveLength(1);
  });

  it("is left to the command's own trap once the command ran", async () => {
    await executeSyncJob("job-1");

    const keyPath = writtenKeyPath();
    expect(removalsOf(keyPath)).toHaveLength(0);
    expect(remote.commands.some((command) => command.startsWith("trap ") && command.includes(keyPath))).toBe(true);
  });
});
