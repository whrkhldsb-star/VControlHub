import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeSsh } from "./helpers/fake-sshd";

/**
 * executeSyncJob end to end against real directories: the SSH layer is
 * replaced by a local /bin/sh, so every remote command the job builds actually
 * runs (with HOME in the test's temp directory, whose authorized_keys takes the
 * run's one-time key). rsync is reported missing to drive the tar fallback (the
 * guard under test runs before the transport is chosen).
 */
const posix = process.platform !== "win32";

const state = vi.hoisted(() => ({ bin: "", home: "", job: null as Record<string, unknown> | null, runNothing: false, ran: [] as string[] }));

// Execution-time authorisation has its own tests (execution-actor).
vi.mock("@/lib/auth/execution-actor", () => ({ executionRefusal: vi.fn(async () => null), loadExecutionActor: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    syncJob: { updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({})) },
    syncLog: { create: vi.fn(async () => ({ id: "log-1" })), update: vi.fn(async () => ({})) },
  },
}));
vi.mock("../service-crud", () => ({
  getSyncJobForExecution: vi.fn(async () => state.job),
  assertSyncEndpointsWithinReach: vi.fn(async () => {}), assertDisjointSyncEndpoints: vi.fn(),
}));
vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/lib/ssh/client", () => ({
  buildSshParamsFromServer: vi.fn(async () => ({})),
  writeRemoteFile: vi.fn(async ({ remotePath, content }: { remotePath: string; content: string }) => {
    writeFileSync(remotePath, content);
  }),
  execRemoteCommand: vi.fn(async ({ command }: { command: string }) => {
    if (state.runNothing) {
      state.ran.push(command);
      return { stdout: "", stderr: "no command may run in this test", exitCode: 1 };
    }
    // These commands really run on this machine. Never let them near anything outside the test's own temp directory
    // (a test aimed at "/etc" once emptied the real /etc when the guard it exercises had been reverted). The key
    // scripts edit $HOME/.ssh/authorized_keys, so HOME must be the test's own too.
    const job = state.job as { sourcePath?: string; targetPath?: string } | null;
    for (const endpoint of [job?.sourcePath, job?.targetPath, state.home]) {
      if (endpoint && !endpoint.startsWith(tmpdir())) {
        throw new Error(`refusing to run a sync command for ${endpoint}: outside the temp directory`);
      }
    }
    if (!state.home) throw new Error("refusing to run a sync command without a test HOME");
    if (command.startsWith("which rsync")) return { stdout: "MISSING\n", stderr: "", exitCode: 1 };
    const result = spawnSync("/bin/sh", ["-c", command], {
      encoding: "utf8",
      env: { ...process.env, HOME: state.home, PATH: `${state.bin}:${process.env.PATH}` },
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status };
  }),
}));

import { executeSyncJob } from "../service-runtime";

let root: string;
let source: string;
let target: string;

function useJob(syncType: string, deleteOrphans = false) {
  state.job = {
    id: "job-1",
    syncType,
    deleteOrphans,
    compress: false,
    sourcePath: source,
    targetPath: target,
    // The one-time key is installed for the user the hub runs as: here, whoever runs the tests.
    sourceServer: { id: "src", host: "source.invalid", port: 22, username: userInfo().username, sshKey: null, syncTargetAuth: "one-time-key" },
    targetServer: { id: "dst", host: "target.invalid", port: 22, username: userInfo().username, sshKey: null, hostKeySha256: null, syncTargetAuth: "one-time-key" },
  };
}

describe.skipIf(!posix)("executeSyncJob — mirror source guard on real directories", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vch-mirror-guard-"));
    state.bin = join(root, "bin");
    state.home = join(root, "home");
    source = join(root, "source");
    target = join(root, "target");
    mkdirSync(state.bin);
    mkdirSync(state.home);
    mkdirSync(target);
    installFakeSsh(state.bin);
    writeFileSync(join(target, "valuable.txt"), "existing data");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    state.home = "";
  });

  it("refuses a MIRROR whose source directory does not exist and does not create it", async () => {
    useJob("MIRROR");
    const result = await executeSyncJob("job-1");
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/does not exist/);
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(join(target, "valuable.txt"), "utf8")).toBe("existing data");
  });

  it("refuses a one-way delete-orphans run whose source is missing", async () => {
    useJob("ONE_WAY", true);
    const result = await executeSyncJob("job-1");
    expect(result.ok).toBe(false);
    expect(readdirSync(target)).toEqual(["valuable.txt"]);
  });

  it("refuses to mirror an empty source (e.g. an unmounted mount point) over a non-empty target", async () => {
    mkdirSync(source);
    useJob("MIRROR");
    const result = await executeSyncJob("job-1");
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/is empty; refusing/);
    expect(readdirSync(target)).toEqual(["valuable.txt"]);
  });

  it("refuses a deleting run aimed at a system directory before it runs anything", async () => {
    // A job saved before creation refused such targets: the source only had to be non-empty to empty /etc.
    // The SSH layer is replaced here by a stub that runs NOTHING: this test must never execute a command, so it
    // cannot touch the real system directory it names even if the guard were missing.
    mkdirSync(source);
    writeFileSync(join(source, "fresh.txt"), "new data");
    useJob("MIRROR");
    (state.job as { targetPath: string }).targetPath = "/etc";
    state.runNothing = true;
    try {
      const result = await executeSyncJob("job-1");
      expect(result.ok).toBe(false);
      expect(result.errorMessage).toMatch(/system directory/);
      expect(state.ran).toEqual([]);
    } finally {
      state.runNothing = false;
    }
    expect(readdirSync(source)).toEqual(["fresh.txt"]);
  });

  it("mirrors a populated source", async () => {
    mkdirSync(source);
    writeFileSync(join(source, "fresh.txt"), "new data");
    useJob("MIRROR");
    const result = await executeSyncJob("job-1");
    expect(result.ok, result.errorMessage).toBe(true);
    expect(readdirSync(target)).toEqual(["fresh.txt"]);
  });

  it("still lets a non-deleting one-way copy into an empty target proceed from an empty source", async () => {
    mkdirSync(source);
    rmSync(join(target, "valuable.txt"));
    useJob("ONE_WAY", false);
    const result = await executeSyncJob("job-1");
    expect(result.ok, result.errorMessage).toBe(true);
  });
});
