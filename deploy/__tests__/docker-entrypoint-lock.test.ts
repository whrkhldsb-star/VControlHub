// @vitest-environment node
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Normalize CRLF: Windows checkouts (core.autocrlf) keep the working copy in
// CRLF while the committed content (and Linux CI) is LF.
const entrypoint = readFileSync(path.resolve(process.cwd(), "docker-entrypoint.sh"), "utf8").replace(/\r\n/g, "\n");

// The lock holder's script, extracted verbatim from the shell function so the
// test exercises what ships.
const lockScript = entrypoint.match(/node -e '\n([\s\S]*?)\n  '/)?.[1];
const lockKeyValue = (name: string) => entrypoint.match(new RegExp(`${name}=(\\d+)`))?.[1];

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("docker-entrypoint.sh migration/seed serialization (D-02)", () => {
  it("keeps the POSIX sh shebang and fails fast when migrations or the lock fail", () => {
    expect(entrypoint.startsWith("#!/bin/sh\n")).toBe(true);
    // A failing migration or seed must exit non-zero instead of starting the app.
    expect(entrypoint).toContain('prisma migrate deploy || { echo "entrypoint: prisma migrate deploy failed" >&2');
    expect(entrypoint).toContain('node dist/seed.js || { echo "entrypoint: seed failed" >&2');
    // The lock is released on both failure paths (no deadlock for the next replica).
    expect(entrypoint.match(/release_migration_lock; return 1/g)).toHaveLength(2);
  });

  it("uses a documented PostgreSQL session advisory lock outside the platform's namespaces", () => {
    const key1 = Number(lockKeyValue("MIGRATION_LOCK_KEY1"));
    const key2 = Number(lockKeyValue("MIGRATION_LOCK_KEY2"));
    // 45057..45099 belongs to src/lib/concurrency/advisory-lock.ts (and the
    // test namespace 45999 to one-file-at-a-time.ts); the entrypoint must
    // stay clear of both ranges.
    expect(Number.isInteger(key1)).toBe(true);
    expect(key2).toBe(0);
    expect(key1).toBeLessThan(45057);
    expect(entrypoint).toContain("pg_advisory_lock($1, $2)");
  });

  it("takes the advisory lock and reports READY before holding the session open", async () => {
    expect(lockScript).toBeTruthy();
    const root = await mkdtemp(path.join(tmpdir(), "vch-entrypoint-"));
    roots.push(root);
    // A stub `pg` package: records the lock call, then resolves.
    const pgDir = path.join(root, "node_modules", "pg");
    await mkdir(pgDir, { recursive: true });
    await writeFile(path.join(pgDir, "index.js"), `
      class Client {
        constructor(options) { this.log = ["ctor:" + options.connectionString]; }
        on() {}
        connect() { return Promise.resolve(); }
        async query(text, values) { this.log.push("query:" + text + ":" + JSON.stringify(values)); return { rows: [] }; }
        end() { this.log.push("end"); return Promise.resolve(); }
      }
      module.exports = { Client };
    `);
    await writeFile(path.join(pgDir, "package.json"), '{"name":"pg","main":"index.js","type":"commonjs"}');
    const scriptPath = path.join(root, "holder.cjs");
    await writeFile(scriptPath, `${lockScript}\n`);
    const out = execFileSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://u:p@db:5432/x",
        MIGRATION_LOCK_KEY1: lockKeyValue("MIGRATION_LOCK_KEY1") ?? "",
        MIGRATION_LOCK_KEY2: lockKeyValue("MIGRATION_LOCK_KEY2") ?? "",
        NODE_PATH: path.join(root, "node_modules"),
      },
      timeout: 15_000,
    });
    expect(out.trim()).toBe("READY");
  });

  it("keeps RUN_MIGRATIONS_ON_START=false / SEED_ON_START=false clean for multi-replica deployments", () => {
    // The whole gated block (lock + migrate + seed) is skipped when both
    // flags are off, so extra replicas never touch the database at start.
    expect(entrypoint).toContain('if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ] || [ "${SEED_ON_START:-true}" = "true" ]; then');
    expect(entrypoint).toContain("run_startup_migrations\nfi");
    expect(entrypoint).not.toContain("run_startup_migrations || true");
  });
});
