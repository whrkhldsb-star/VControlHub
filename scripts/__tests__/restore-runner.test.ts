// @vitest-environment node
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveLocalTarBinary } from "@/lib/runtime/tar-binary";

const runFile = promisify(execFile);
const runner = path.resolve("scripts/restore.mjs");

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
    env = { ...process.env, APP_DIR: fallback, CONFIRM_RESTORE: "0", ENV_FILE: path.join(tmp, "missing.env") };
  });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it("restores files into the explicit positional destination without touching APP_DIR", async () => {
    await runFile(process.execPath, [runner, "files", archive, target], { env });
    expect(await readFile(path.join(target, "hello.txt"), "utf8")).toBe("restored fixture");
    expect(await readdir(target)).toEqual(["hello.txt"]);
    expect(await readdir(fallback)).toEqual([]);
  });

  it.each(process.platform === "win32" ? ["node"] : ["node", "bash"])("%s full restore requires database confirmation before overwriting any files", async (kind) => {
    await writeFile(path.join(target, "hello.txt"), "preserve current data");
    const file = kind === "node" ? process.execPath : "bash";
    const args = kind === "node" ? [runner, "full", archive, "all", target] : ["scripts/restore-full.sh", archive, "all", target];
    await expect(runFile(file, args, { env })).rejects.toThrow();
    expect(await readFile(path.join(target, "hello.txt"), "utf8")).toBe("preserve current data");
  });

  it("checks the database configuration before a confirmed full restore changes files", async () => {
    await writeFile(path.join(target, "hello.txt"), "preserve current data");
    await expect(runFile(process.execPath, [runner, "full", archive, "all", target], { env: { ...env, CONFIRM_RESTORE: "1" } })).rejects.toThrow();
    expect(await readFile(path.join(target, "hello.txt"), "utf8")).toBe("preserve current data");
  });

  it.skipIf(process.platform === "win32")("keeps the chosen database even when the archive restores an older .env.local", async () => {
    const bin = path.join(tmp, "bin");
    const capture = path.join(tmp, "connection.json");
    await mkdir(bin);
    const psql = path.join(bin, "psql");
    await writeFile(psql, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.RESTORE_CAPTURE, JSON.stringify({ args: process.argv.slice(2), password: process.env.PGPASSWORD })); process.stdin.resume();\n`);
    await chmod(psql, 0o755);
    await writeFile(path.join(target, ".env.local"), "DATABASE_URL=postgresql://tester:target-secret@127.0.0.1/audit_target\n");
    await writeFile(path.join(source, ".env.local"), "DATABASE_URL=postgresql://tester:archive-secret@127.0.0.1/archive_database\n");
    // The ./database.sql.gz spelling is valid too.
    await runFile(resolveLocalTarBinary(), ["-czf", archive, "-C", source, "."]);
    await runFile(process.execPath, [runner, "full", archive, "all", target], { env: {
      ...env, CONFIRM_RESTORE: "1", ENV_FILE: path.join(target, ".env.local"),
      PATH: `${bin}${path.delimiter}${process.env.PATH}`, RESTORE_CAPTURE: capture,
    } });
    const connection = JSON.parse(await readFile(capture, "utf8"));
    expect(connection.args.join(" ")).toContain("/audit_target");
    expect(connection.args.join(" ")).not.toContain("secret");
    expect(connection.password).toBe("target-secret");
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
});
