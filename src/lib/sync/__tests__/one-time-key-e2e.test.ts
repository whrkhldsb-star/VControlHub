import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeSsh } from "./helpers/fake-sshd";

/**
 * executeSyncJob end to end with real files and real shells: every command the
 * hub sends runs locally under /bin/sh, with HOME pointed at a scratch
 * directory whose .ssh/authorized_keys plays the target's. The source side's
 * `ssh` is a stand-in for OpenSSH on both ends (helpers/fake-sshd): it accepts
 * only a key listed there and runs that line's forced command. rsync, when
 * installed, is the real one on both ends.
 */
const posix = process.platform !== "win32";
const hasRsync = posix && spawnSync("sh", ["-c", "command -v rsync"]).status === 0;
const me = userInfo().username;
const TARGET_PASSWORD = "target-own-password-e2e";
const TARGET_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nTARGET-OWN-KEY-E2E\n-----END OPENSSH PRIVATE KEY-----\n";
const JOB_ID = "e2e-otk";

const state = vi.hoisted(() => ({
  root: "",
  bin: "",
  home: "",
  job: null as Record<string, unknown> | null,
  rsyncMissing: false,
  refuseKeys: false,
  sshVersion: "OpenSSH_9.6p1",
  failTransfer: false,
  toSource: [] as string[],
}));

vi.mock("@/lib/auth/execution-actor", () => ({ executionRefusal: vi.fn(async () => null), loadExecutionActor: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    syncJob: { updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({})) },
    syncLog: { create: vi.fn(async () => ({ id: "log-1" })), update: vi.fn(async () => ({})) },
  },
}));
vi.mock("../service-crud", () => ({
  getSyncJobForExecution: vi.fn(async () => state.job),
  assertSyncEndpointsWithinReach: vi.fn(async () => {}),
  assertDisjointSyncEndpoints: vi.fn(),
}));
vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/lib/ssh/client", () => ({
  buildSshParamsFromServer: vi.fn(async (server: { id: string }) => server.id === "dst"
    ? { host: "target", password: TARGET_PASSWORD, privateKey: TARGET_KEY }
    : { host: "source", password: "source-own-password" }),
  writeRemoteFile: vi.fn(async ({ host, remotePath, content }: { host: string; remotePath: string; content: string }) => {
    if (host === "source") state.toSource.push(String(content));
    writeFileSync(remotePath, content);
  }),
  execRemoteCommand: vi.fn(async ({ host, command }: { host: string; command: string }) => {
    // These commands really run on this machine. Never near anything outside the test's own temp directory, and
    // never with the real HOME: the key scripts edit $HOME/.ssh/authorized_keys.
    const job = state.job as { sourcePath?: string; targetPath?: string } | null;
    for (const endpoint of [job?.sourcePath, job?.targetPath, state.home]) {
      if (!endpoint || !endpoint.startsWith(tmpdir())) throw new Error(`refusing to run a sync command for ${endpoint}: outside the temp directory`);
    }
    if (host === "source") state.toSource.push(command);
    if (command.startsWith("which rsync") && state.rsyncMissing) return { stdout: "MISSING\n", stderr: "", exitCode: 1 };
    if (state.failTransfer && command.startsWith("trap ")) return { stdout: "", stderr: "injected transfer failure", exitCode: 1 };
    const result = spawnSync("/bin/sh", ["-c", command], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: state.home,
        PATH: `${state.bin}:${process.env.PATH}`,
        VCH_TEST_SSH_LOG: join(state.root, "ssh.log"),
        VCH_TEST_SSH_VERSION: state.sshVersion,
        VCH_TEST_SSHD_REFUSE_KEYS: state.refuseKeys ? "1" : "",
      },
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status };
  }),
}));

import { executeSyncJob } from "../service-runtime";

const EXISTING = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExistingAdminKeyExistingAdminKeyExistingAd admin@laptop";
let source: string;
let target: string;
let authorizedKeys: string;

function useJob(syncType: string, overrides: { targetConnection?: string } = {}) {
  state.job = {
    id: JOB_ID,
    status: "IDLE",
    syncType,
    deleteOrphans: false,
    compress: false,
    sourceServerId: "src",
    targetServerId: "dst",
    sourcePath: source,
    targetPath: target,
    sourceServer: { id: "src", name: "web", host: "source.invalid", port: 22, username: me, connectionType: "SSH_KEY", sshKey: null, hostKeySha256: null },
    targetServer: { id: "dst", name: "backup", host: "target.invalid", port: 22, username: me, connectionType: overrides.targetConnection ?? "SSH_KEY", sshKey: null, hostKeySha256: null },
  };
}

type SshLogEntry = { command: string; options?: Record<string, string | true>; denied?: string };
function sshLog(): SshLogEntry[] {
  const path = join(state.root, "ssh.log");
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as SshLogEntry) : [];
}

function sourceKeyFiles(): string[] {
  return readdirSync("/tmp").filter((name) => name.startsWith("app-sync-") && name.includes(JOB_ID));
}

/** What a run must leave behind, however it ended. */
function expectNothingLeftBehind() {
  expect(readFileSync(authorizedKeys, "utf8")).toBe(`${EXISTING}\n`);
  expect(sourceKeyFiles()).toEqual([]);
  const sent = state.toSource.join("\n");
  expect(sent).not.toContain(TARGET_PASSWORD);
  expect(sent).not.toContain("TARGET-OWN-KEY");
  expect(sent).not.toMatch(/sshpass|SSHPASS/);
}

describe.skipIf(!posix)("one-time target key, end to end", () => {
  beforeEach(() => {
    state.root = mkdtempSync(join(tmpdir(), "vch-otk-e2e-"));
    state.bin = join(state.root, "bin");
    state.home = join(state.root, "home");
    source = join(state.root, "source");
    target = join(state.root, "target");
    authorizedKeys = join(state.home, ".ssh", "authorized_keys");
    mkdirSync(state.bin);
    mkdirSync(join(state.home, ".ssh"), { recursive: true, mode: 0o700 });
    mkdirSync(source);
    mkdirSync(target);
    installFakeSsh(state.bin);
    // The target user's own key, without a final newline.
    writeFileSync(authorizedKeys, EXISTING, { mode: 0o600 });
    writeFileSync(join(source, "fresh.txt"), "new data");
    writeFileSync(join(target, "old.txt"), "old data");
    Object.assign(state, { rsyncMissing: false, refuseKeys: false, sshVersion: "OpenSSH_9.6p1", failTransfer: false, toSource: [] });
  });

  afterEach(() => {
    rmSync(state.root, { recursive: true, force: true });
    for (const name of sourceKeyFiles()) rmSync(join("/tmp", name), { force: true });
  });

  it.skipIf(!hasRsync)("copies with rsync through the gate, pinned to the source's address, and cleans up", async () => {
    useJob("ONE_WAY");

    const result = await executeSyncJob(JOB_ID);

    expect(result.ok, result.errorMessage).toBe(true);
    expect(readFileSync(join(target, "fresh.txt"), "utf8")).toBe("new data");
    expect(readFileSync(join(target, "old.txt"), "utf8")).toBe("old data");
    const transfer = sshLog().find((entry) => entry.command.startsWith("rsync --server"));
    expect(transfer?.options).toMatchObject({ restrict: true, from: "198.51.100.7" });
    expect(String(transfer?.options?.["expiry-time"])).toMatch(/^\d{12}$/);
    expect(String(transfer?.options?.command)).toContain("vch-sync-gate");
    // The source named no destination; the gate supplied the job's.
    expect(transfer?.command).toMatch(/ \. \.$/);
    expectNothingLeftBehind();
  });

  it("mirrors with the tar fallback through the gate's fixed phases, and cleans up", async () => {
    useJob("MIRROR");
    state.rsyncMissing = true;

    const result = await executeSyncJob(JOB_ID);

    expect(result.ok, result.errorMessage).toBe(true);
    expect(readdirSync(target)).toEqual(["fresh.txt"]);
    expect(sshLog().filter((entry) => entry.options).map((entry) => entry.command)).toEqual([
      "vch-sync hello", "vch-sync tar-receive", "vch-sync tar-commit",
    ]);
    expectNothingLeftBehind();
  });

  it.skipIf(!hasRsync)("syncs both ways with a key per leg and leaves neither behind", async () => {
    useJob("BIDIRECTIONAL");
    writeFileSync(join(target, "from-target.txt"), "b side");

    const result = await executeSyncJob(JOB_ID);

    expect(result.ok, result.errorMessage).toBe(true);
    expect(readFileSync(join(target, "fresh.txt"), "utf8")).toBe("new data");
    expect(readFileSync(join(source, "from-target.txt"), "utf8")).toBe("b side");
    expect(sshLog().filter((entry) => entry.command.startsWith("rsync --server"))).toHaveLength(2);
    expectNothingLeftBehind();
  });

  it("removes the key when the transfer fails", async () => {
    useJob("ONE_WAY");
    state.rsyncMissing = true;
    state.failTransfer = true;

    const result = await executeSyncJob(JOB_ID);

    expect(result.ok).toBe(false);
    expect(readFileSync(join(target, "old.txt"), "utf8")).toBe("old data");
    expectNothingLeftBehind();
  });

  it("stops with a clear error, and removes the key, when the target refuses public-key login", async () => {
    useJob("ONE_WAY", { targetConnection: "PASSWORD" });
    state.refuseKeys = true;

    const result = await executeSyncJob(JOB_ID);

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/did not accept the one-time sync key from the source server \(Permission denied \(publickey\)\.\)/);
    expect(result.errorMessage).toMatch(/with a password, and sync no longer hands that password to the source server/);
    expect(readdirSync(target).sort()).toEqual(["old.txt"]);
    expectNothingLeftBehind();
  });

  it("works with an sshd too old for restrict, using the options it knows", async () => {
    useJob("ONE_WAY");
    state.rsyncMissing = true;
    state.sshVersion = "OpenSSH_7.1p2";

    const result = await executeSyncJob(JOB_ID);

    expect(result.ok, result.errorMessage).toBe(true);
    const transfer = sshLog().find((entry) => entry.command === "vch-sync tar-receive");
    expect(transfer?.options).toMatchObject({ "no-pty": true, "no-port-forwarding": true, from: "198.51.100.7" });
    expect(transfer?.options?.restrict).toBeUndefined();
    expectNothingLeftBehind();
  });

  it("refuses the run's key from any address but the source's once it is pinned", async () => {
    useJob("ONE_WAY");
    state.rsyncMissing = true;
    // The source answers hello from one address and transfers from another,
    // which is what the key looks like when it is used anywhere else.
    const realSsh = readFileSync(join(state.bin, "ssh"), "utf8");
    writeFileSync(join(state.bin, "ssh"), realSsh.replace(
      'const clientIp = process.env.VCH_TEST_CLIENT_IP || "198.51.100.7";',
      'const clientIp = command === "vch-sync hello" ? "198.51.100.7" : "192.0.2.66";',
    ));

    const result = await executeSyncJob(JOB_ID);

    expect(result.ok).toBe(false);
    expect(sshLog().find((entry) => entry.command === "vch-sync tar-receive")?.denied).toMatch(/does not match/);
    expect(readFileSync(join(target, "old.txt"), "utf8")).toBe("old data");
    expectNothingLeftBehind();
  });
});
