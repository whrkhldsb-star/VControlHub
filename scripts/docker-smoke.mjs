import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

// Disposable PostgreSQL and app containers; no host Docker socket is mounted.
const run = promisify(execFile);
const image = process.argv[2] || "vcontrolhub:ci";
const prefix = `vch-smoke-${randomBytes(6).toString("hex")}`;
const network = `${prefix}-net`;
const database = `${prefix}-db`;
const app = `${prefix}-app`;
const directory = await mkdtemp(path.join(tmpdir(), "vch-docker-smoke-"));
const password = randomBytes(24).toString("hex");
const adminPassword = randomBytes(24).toString("hex");
const docker = async (...args) => (await run("docker", args, { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
const databaseEnv = path.join(directory, "postgres.env");
const appEnv = path.join(directory, "app.env");

try {
  await writeFile(databaseEnv, `POSTGRES_DB=vcontrolhub_ci_smoke\nPOSTGRES_USER=smoke\nPOSTGRES_PASSWORD=${password}\n`, { mode: 0o600 });
  const values = {
    DATABASE_URL: `postgresql://smoke:${password}@${database}:5432/vcontrolhub_ci_smoke`,
    AUTH_SESSION_SECRET: randomBytes(32).toString("hex"),
    ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    SSH_WS_SECRET: randomBytes(32).toString("hex"),
    ADMIN_INITIAL_PASSWORD: adminPassword,
    SSH_WS_HOST: "127.0.0.1", SSH_WS_ALLOWED_ORIGINS: "http://127.0.0.1:3000",
    APP_BASE_URL: "http://127.0.0.1:3000", TRUSTED_PROXY_HOPS: "0",
    DOCKER_HOST: "unix:///tmp/no-host-docker.sock", SEED_DEMO_DATA: "false",
  };
  await writeFile(appEnv, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
  await docker("network", "create", network);
  await docker("run", "--detach", "--name", database, "--network", network, "--env-file", databaseEnv, "postgres:16-alpine");
  let databaseReady = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await docker("exec", database, "pg_isready", "-U", "smoke", "-d", "vcontrolhub_ci_smoke"); databaseReady = true; break; }
    catch { await delay(1_000); }
  }
  if (!databaseReady) throw new Error("Disposable PostgreSQL did not become ready");
  await docker("run", "--detach", "--name", app, "--network", network, "--env-file", appEnv, "--publish", "127.0.0.1::3000", image);
  const port = (await docker("port", app, "3000/tcp")).split(":").at(-1);
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { const response = await fetch(`${origin}/api/status`, { signal: AbortSignal.timeout(3_000) }); if (response.ok) { ready = true; break; } }
    catch { /* Wait for migrations, seed and both gateways. */ }
    await delay(1_000);
  }
  if (!ready) throw new Error("Container did not become ready after fresh migration and seed");
  await docker("exec", app, "node", "-e", `
    const { Client } = require('pg');
    (async () => { const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
    await db.query('UPDATE "User" SET "mustChangePassword"=false, status=$1 WHERE username=$2', ['ACTIVE', 'admin']);
    await db.end(); })().catch(error => { console.error(error.message); process.exit(1); });
  `);
  const login = await fetch(`${origin}/api/login`, { method: "POST", redirect: "manual", body: new URLSearchParams({ username: "admin", password: adminPassword }) });
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  if (login.status !== 303 || !cookie || login.headers.get("location")?.includes("login?")) throw new Error("Fresh container login failed");
  const documentation = await fetch(`${origin}/api/docs/openapi`, { headers: { Cookie: cookie } });
  if (!documentation.ok) throw new Error(`Authenticated route catalogue unavailable: HTTP ${documentation.status}`);
  const specification = await documentation.json();
  if (!specification.paths?.["/servers/{id}/rdp-probe"]) throw new Error("Runtime route catalogue is missing rdp-probe");
  const processes = await docker("exec", app, "sh", "-c", "for task in /proc/[0-9]*/cmdline; do tr '\\000' ' ' < \"$task\" 2>/dev/null; printf '\\n'; done");
  for (const entry of ["dist/server.js", "dist/worker.js", "dist/ssh-ws-proxy.js"]) {
    if (!processes.includes(`node ${entry}`)) throw new Error(`Missing container process: ${entry}`);
  }
  await docker("exec", app, "node", "-e", "require('prisma/config'); require('dotenv'); if(require('node:fs').existsSync('node_modules/tsx')) process.exit(1);");
  console.log("docker-smoke-ok: fresh migrations, bundled seed, login, authenticated OpenAPI, web/worker/gateway processes and production-only dependencies");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Docker smoke failed");
  try {
    const logs = (await docker("logs", "--tail", "60", app)).replaceAll(password, "[redacted]").replaceAll(adminPassword, "[redacted]");
    console.error(logs.slice(-8_000));
  } catch { /* Container may not have been created. */ }
  process.exitCode = 1;
} finally {
  await docker("rm", "--force", "--volumes", app, database).catch(() => undefined);
  await docker("network", "rm", network).catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
