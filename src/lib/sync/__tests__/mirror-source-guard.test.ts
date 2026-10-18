import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * executeSyncJob end to end against real directories: the SSH layer is
 * replaced by a local /bin/sh, so every remote command the job builds actually
 * runs. rsync is reported missing to drive the tar fallback (the guard under
 * test runs before the transport is chosen).
 */
const posix = process.platform !== "win32";

const state = vi.hoisted(() => ({ bin: "", job: null as Record<string, unknown> | null }));

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
  assertDisjointSyncEndpoints: vi.fn(),
}));
vi.mock("../service-credentials", () => ({
  decryptSyncTargetCredentials: vi.fn(() => ({ password: "fixture-password" })),
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
    if (command.startsWith("which rsync")) return { stdout: "MISSING\n", stderr: "", exitCode: 1 };
    const result = spawnSync("/bin/sh", ["-c", command], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${state.bin}:${process.env.PATH}` },
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status };
  }),
}));

import { executeSyncJob } from "../service-runtime";

let root: string;
let source: string;
let target: string;

function writeExecutable(path: string, body: string) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function useJob(syncType: string, deleteOrphans = false) {
  state.job = {
    id: "job-1",
    syncType,
    deleteOrphans,
    compress: false,
    sourcePath: source,
    targetPath: target,
    sourceServer: { id: "src", host: "source.invalid", port: 22, username: "audit", sshKey: null },
    targetServer: { id: "dst", host: "target.invalid", port: 22, username: "audit", sshKey: null, hostKeySha256: null },
  };
}

describe.skipIf(!posix)("executeSyncJob — mirror source guard on real directories", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vch-mirror-guard-"));
    state.bin = join(root, "bin");
    source = join(root, "source");
    target = join(root, "target");
    mkdirSync(state.bin);
    mkdirSync(target);
    writeExecutable(join(state.bin, "ssh"), '#!/bin/sh\nfor last; do :; done\nexec /bin/sh -c "$last"\n');
    writeExecutable(join(state.bin, "sshpass"), '#!/bin/sh\nshift\nexec "$@"\n');
    writeFileSync(join(target, "valuable.txt"), "existing data");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
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
