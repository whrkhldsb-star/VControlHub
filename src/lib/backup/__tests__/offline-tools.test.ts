// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { pgConnection, redactConnectionString } from "../../../../scripts/lib/backup-common.mjs";
import { installFakeRestoreTools } from "../../../../scripts/__tests__/helpers/fake-restore-tools";

const run = promisify(execFile);

it("rejects TLS key passphrases before building process argv and masks both libpq secrets", () => {
  const uri = "postgresql://fixture:login-pass@localhost/test?sslpassword=tls-pass&sslmode=require";
  expect(() => pgConnection({ DATABASE_URL: uri })).toThrow("private libpq service file");
  const diagnostic = redactConnectionString(uri + " password='login-pass' sslpassword='tls-pass'");
  expect(diagnostic).not.toMatch(/login-pass|tls-pass/);
  expect(redactConnectionString("postgresql://localhost/test?sslpassword=part@tail")).not.toContain("tail");
  expect(redactConnectionString("sslpassword='one\\'two' host=local password=three\\ four"))
    .toBe("sslpassword=[REDACTED] host=local password=[REDACTED]");
  const ordinary = pgConnection({ DATABASE_URL: "postgresql://fixture:login-pass@localhost/test?sslmode=require" });
  expect(ordinary.connArgs.join(" ")).not.toContain("login-pass");
  expect(ordinary.childEnv.PGPASSWORD).toBe("login-pass");
});

it.skipIf(process.platform === "win32")("cleans staged history when the post-database offline check refuses the files phase", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "backup-partial-cleanup-"));
  try {
    const app = path.join(root, "app"), source = path.join(root, "source"), stage = path.join(root, "temp");
    await Promise.all([app, source, stage].map((dir) => mkdir(dir)));
    await mkdir(path.join(source, "history"));
    await writeFile(path.join(source, "history", "revision"), "fixture version");
    await writeFile(path.join(source, "file-versions.json"), JSON.stringify({ version: 1, member: "history" }));
    await writeFile(path.join(source, "database.sql.gz"), gzipSync("-- PostgreSQL database dump\n-- PostgreSQL database dump complete\n"));
    const archive = path.join(root, "full.tar.gz");
    await run("tar", ["-czf", archive, "-C", source, "."]);
    const bin = await installFakeRestoreTools(root);
    const capture = path.join(root, "psql.json");
    const psql = path.join(bin, "psql");
    const script = await readFile(psql, "utf8");
    await writeFile(psql, script.replace('Number(process.env.FAKE_PSQL_OTHER_CLIENTS || "0")', 'Number(fs.existsSync(process.env.RESTORE_CAPTURE))'));
    const envFile = path.join(root, "restore.env");
    await writeFile(envFile, "DATABASE_URL=postgresql://fixture@localhost/test\n");
    await expect(run(process.execPath, ["scripts/restore.mjs", "full", archive, "all", app], { env: {
      ...process.env, APP_DIR: app, ENV_FILE: envFile, DATABASE_URL: "postgresql://fixture@localhost/test",
      TMPDIR: stage, PATH: bin + path.delimiter + process.env.PATH, CONFIRM_RESTORE: "1",
      DEPLOY_LOCK: path.join(root, "unused.lock"), RESTORE_CAPTURE: capture,
    } })).rejects.toMatchObject({ stderr: expect.stringContaining("PARTIAL RESTORE") });
    expect(await readdir(stage)).toEqual([]);
    expect(await readdir(app)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
