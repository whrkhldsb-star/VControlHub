// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveLocalTarBinary } from "@/lib/runtime/tar-binary";
import { installFakeRestoreTools } from "./helpers/fake-restore-tools";

const runFile = promisify(execFile);
const runner = path.resolve("scripts/restore.mjs");
// On Windows the fake psql is a .cmd wrapper, which Node cannot spawn without a
// shell, and VCONTROLHUB_SERVICE_UNITS=none skips the service check; the cases
// that reach either run on POSIX only (a Windows restore uses the real psql.exe).
const posixOnly = process.platform === "win32";

describe("restore runner destination and preflight", () => {
  let tmp: string;
  let source: string;
  let fallback: string;
  let target: string;
  let archive: string;
  let env: NodeJS.ProcessEnv;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "vch-restore-runner-"));
    source = path.join(tmp, "source");
    fallback = path.join(tmp, "fallback");
    target = path.join(tmp, "explicit destination");
    archive = path.join(tmp, "full.tar.gz");
    await Promise.all([source, fallback, target].map((directory) => mkdir(directory)));
    await writeFile(path.join(source, "hello.txt"), "restored fixture");
    await writeFile(path.join(source, "database.sql.gz"), gzipSync("SELECT 1;\n"));
    await runFile(resolveLocalTarBinary(), ["-czf", archive, "-C", source, "hello.txt", "database.sql.gz"]);
    const bin = await installFakeRestoreTools(tmp);
    await writeFile(path.join(tmp, "restore.env"), "DATABASE_URL=postgresql://tester:test-secret@127.0.0.1/audit_target\n");
    env = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      APP_DIR: fallback,
      CONFIRM_RESTORE: "1",
      ENV_FILE: path.join(tmp, "restore.env"),
      // Hermetic: a deploy.sh running on this host must not refuse the test restores.
      DEPLOY_LOCK: path.join(tmp, "no-deploy.lock"),
      // No systemd on Windows: the operator's explicit confirmation.
      ...(process.platform === "win32" ? { VCONTROLHUB_SERVICE_UNITS: "none" } : {}),
    };
  });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it.skipIf(posixOnly)("restores files into the explicit positional destination without touching APP_DIR", async () => {
    await runFile(process.execPath, [runner, "files", archive, target], { env });
    expect(await readFile(path.join(target, "hello.txt"), "utf8")).toBe("restored fixture");
    expect(await readdir(target)).toEqual(["hello.txt"]);
    expect(await readdir(fallback)).toEqual([]);
  });

  it.each(process.platform === "win32" ? ["node"] : ["node", "bash"])("%s full restore requires database confirmation before overwriting any files", async (kind) => {
    await writeFile(path.join(target, "hello.txt"), "preserve current data");
    const file = kind === "node" ? process.execPath : "bash";
    const args = kind === "node" ? [runner, "full", archive, "all", target] : ["scripts/restore-full.sh", archive, "all", target];
    await expect(runFile(file, args, { env: { ...env, CONFIRM_RESTORE: "0" } })).rejects.toThrow();
    expect(await readFile(path.join(target, "hello.txt"), "utf8")).toBe("preserve current data");
  });

  it("checks the database configuration before a confirmed full restore changes files", async () => {
    await writeFile(path.join(target, "hello.txt"), "preserve current data");
    await expect(runFile(process.execPath, [runner, "full", archive, "all", target], { env: { ...env, ENV_FILE: path.join(tmp, "missing.env") } })).rejects.toThrow();
    expect(await readFile(path.join(target, "hello.txt"), "utf8")).toBe("preserve current data");
  });

  it.skipIf(process.platform === "win32")("keeps the chosen database even when the archive restores an older .env.local", async () => {
    const capture = path.join(tmp, "connection.json");
    await writeFile(path.join(target, ".env.local"), "DATABASE_URL=postgresql://tester:target-secret@127.0.0.1/audit_target\n");
    await writeFile(path.join(source, ".env.local"), "DATABASE_URL=postgresql://tester:archive-secret@127.0.0.1/archive_database\n");
    // The ./database.sql.gz spelling is valid too.
    await runFile(resolveLocalTarBinary(), ["-czf", archive, "-C", source, "."]);
    await runFile(process.execPath, [runner, "full", archive, "all", target], { env: {
      ...env, ENV_FILE: path.join(target, ".env.local"), RESTORE_CAPTURE: capture,
    } });
    const connection = JSON.parse(await readFile(capture, "utf8"));
    expect(connection.args.join(" ")).toContain("/audit_target");
    expect(connection.args.join(" ")).not.toContain("secret");
    expect(connection.password).toBe("target-secret");
    // The import opens with the offline guard inside its single transaction.
    expect(connection.args).toEqual(expect.arrayContaining(["--single-transaction", "-f", "-"]));
    expect(connection.sql).toMatch(/^DO \$vch_offline\$/);
    expect(await readFile(path.join(target, ".env.local"), "utf8")).toContain("archive_database");
  });

  it.skipIf(process.platform === "win32")("validates early archive members even when the index exceeds the diagnostic buffer", async () => {
    await symlink(path.join(tmp, "outside"), path.join(source, "unsafe-link"));
    const name = "a".repeat(200);
    await writeFile(path.join(source, name), "");
    const list = path.join(tmp, "members.txt");
    await writeFile(list, "unsafe-link\n" + `${name}\n`.repeat(6000));
    await runFile(resolveLocalTarBinary(), ["-czf", archive, "-C", source, "-T", list]);
    await expect(runFile(process.execPath, [runner, "files", archive, target], { env })).rejects.toMatchObject({
      stderr: expect.stringContaining("archive links and special files are not supported"),
    });
    expect(await readdir(target)).toEqual([]);
  });

  it.each(process.platform === "win32" ? ["node"] : ["node", "bash"])("%s restore refuses to run while another live restore holds the installation lock", async (kind) => {
    const lock = path.join(fallback, ".restore.lock");
    await mkdir(lock);
    await writeFile(path.join(lock, "owner"), `pid=${process.pid}\nhost=${os.hostname()}\nstartedAt=now\n`);
    const file = kind === "node" ? process.execPath : "bash";
    const args = kind === "node" ? [runner, "files", archive, target] : ["scripts/restore-files.sh", archive, target];
    await expect(runFile(file, args, { env })).rejects.toMatchObject({ stderr: expect.stringContaining("another restore is already running") });
    expect(await readdir(target)).toEqual([]);
    // A refused restore must not remove the live owner's lock.
    expect(await readdir(lock)).toEqual(["owner"]);
  });

  it.skipIf(posixOnly).each(["node", "bash"])("%s restore reclaims a lock left by a dead process and releases it afterwards", async (kind) => {
    const lock = path.join(fallback, ".restore.lock");
    await mkdir(lock);
    // PID 2^22+ is above the default pid_max, so it cannot be alive.
    await writeFile(path.join(lock, "owner"), `pid=${2 ** 22 + 7}\nhost=${os.hostname()}\nstartedAt=then\n`);
    const file = kind === "node" ? process.execPath : "bash";
    const args = kind === "node" ? [runner, "files", archive, target] : ["scripts/restore-files.sh", archive, target];
    await runFile(file, args, { env });
    expect(await readFile(path.join(target, "hello.txt"), "utf8")).toBe("restored fixture");
    expect(await readdir(fallback)).toEqual([]);
  });

  it.skipIf(posixOnly).each(["node", "bash"])("%s restore refuses while a platform service is still running", async (kind) => {
    const file = kind === "node" ? process.execPath : "bash";
    const args = kind === "node" ? [runner, "files", archive, target] : ["scripts/restore-files.sh", archive, target];
    await expect(runFile(file, args, { env: { ...env, FAKE_SYSTEMCTL_STATE: "active" } })).rejects.toMatchObject({
      stderr: expect.stringContaining("OFFLINE RESTORE REQUIRED: vcontrolhub-next (active)"),
    });
    expect(await readdir(target)).toEqual([]);
  });

  it.skipIf(process.platform === "win32").each([
    ["a transitional state", { FAKE_SYSTEMCTL_STATE: "deactivating" }, "vcontrolhub-next (deactivating)"],
    ["an unknown state", { FAKE_SYSTEMCTL_STATE: "unknown" }, "vcontrolhub-next (unknown)"],
    ["a unit systemd does not know (other unit names)", { FAKE_SYSTEMCTL_LOAD: "not-found" }, "vcontrolhub-next (not-found)"],
    ["systemctl failing to report", { FAKE_SYSTEMCTL_FAIL: "1" }, "vcontrolhub-next (state unknown)"],
    ["an empty unit list", { VCONTROLHUB_SERVICE_UNITS: "" }, "VCONTROLHUB_SERVICE_UNITS is empty"],
  ])("fails safe on %s: refuses and leaves the target untouched", async (_name, extra, message) => {
    await expect(runFile(process.execPath, [runner, "files", archive, target], { env: { ...env, ...extra } })).rejects.toMatchObject({
      stderr: expect.stringContaining(message),
    });
    expect(await readdir(target)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("accepts the explicit non-systemd confirmation and still checks database clients", async () => {
    const result = await runFile(process.execPath, [runner, "files", archive, target], { env: { ...env, VCONTROLHUB_SERVICE_UNITS: "none", FAKE_SYSTEMCTL_STATE: "active" } });
    expect(result.stdout + result.stderr).toContain("VCONTROLHUB_SERVICE_UNITS=none");
    expect(await readFile(path.join(target, "hello.txt"), "utf8")).toBe("restored fixture");
    await rm(path.join(target, "hello.txt"));
    await expect(runFile(process.execPath, [runner, "files", archive, target], { env: { ...env, VCONTROLHUB_SERVICE_UNITS: "none", FAKE_PSQL_OTHER_CLIENTS: "1" } })).rejects.toMatchObject({
      stderr: expect.stringContaining("OFFLINE RESTORE REQUIRED"),
    });
    expect(await readdir(target)).toEqual([]);
  });

  it("refuses while deploy.sh holds the deployment lock with a live pid", async () => {
    const deployLock = path.join(tmp, "deploy.lock");
    await writeFile(deployLock, `${process.pid}\n`);
    await expect(runFile(process.execPath, [runner, "files", archive, target], { env: { ...env, DEPLOY_LOCK: deployLock } })).rejects.toMatchObject({
      stderr: expect.stringContaining(`a deployment is running (deploy.sh pid ${process.pid}`),
    });
    expect(await readdir(target)).toEqual([]);
  });

  it.skipIf(posixOnly)("ignores a released or stale deployment lock", async () => {
    const deployLock = path.join(tmp, "deploy.lock");
    // Released: deploy.sh empties the file while still holding flock, then unlocks.
    await writeFile(deployLock, "");
    await runFile(process.execPath, [runner, "files", archive, target], { env: { ...env, DEPLOY_LOCK: deployLock } });
    expect(await readFile(path.join(target, "hello.txt"), "utf8")).toBe("restored fixture");
    // Stale: a pid above pid_max cannot be alive.
    await rm(path.join(target, "hello.txt"));
    await writeFile(deployLock, `${2 ** 22 + 9}\n`);
    await runFile(process.execPath, [runner, "files", archive, target], { env: { ...env, DEPLOY_LOCK: deployLock } });
    expect(await readFile(path.join(target, "hello.txt"), "utf8")).toBe("restored fixture");
  });

  it.skipIf(posixOnly)("refuses a files restore while another client is connected to the database", async () => {
    await expect(runFile(process.execPath, [runner, "files", archive, target], { env: { ...env, FAKE_PSQL_OTHER_CLIENTS: "2" } })).rejects.toMatchObject({
      stderr: expect.stringContaining("OFFLINE RESTORE REQUIRED: 2 other client connection(s)"),
    });
    expect(await readdir(target)).toEqual([]);
  });

  it.skipIf(posixOnly)("refuses a FULL restore before touching files when the database guard finds other clients", async () => {
    await writeFile(path.join(target, "hello.txt"), "preserve current data");
    await expect(runFile(process.execPath, [runner, "full", archive, "all", target], { env: { ...env, FAKE_PSQL_OTHER_CLIENTS: "1" } })).rejects.toMatchObject({
      stderr: expect.stringContaining("OFFLINE RESTORE REQUIRED"),
    });
    expect(await readFile(path.join(target, "hello.txt"), "utf8")).toBe("preserve current data");
  });

  it.skipIf(posixOnly)("appends every outcome to restore-history.jsonl next to the archive", async () => {
    await runFile(process.execPath, [runner, "files", archive, target], { env });
    await expect(runFile(process.execPath, [runner, "files", archive, target], { env: { ...env, FAKE_SYSTEMCTL_STATE: "active" } })).rejects.toThrow();
    const history = (await readFile(path.join(tmp, "restore-history.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(history.map((entry) => [entry.component, entry.status, entry.archive])).toEqual([["files", "COMPLETED", "full.tar.gz"]]);
  });
});
