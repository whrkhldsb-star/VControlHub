// @vitest-environment node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";

it.skipIf(process.platform === "win32")("waits for all services to drain on SIGTERM", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vch-container-stop-"));
  await mkdir(path.join(dir, "dist"));
  const services = ["server.js", "worker.js", "ssh-ws-proxy.js"];
  for (const name of services) {
    await writeFile(path.join(dir, "dist", name), `
      const fs = require("node:fs");
      process.on("SIGTERM", () => {
        setTimeout(() => { fs.writeFileSync("${name}.done", "done"); process.exit(0); }, ${name === "server.js" ? 3000 : 50});
      });
      fs.writeFileSync("${name}.ready", "ready");
      setInterval(() => {}, 1000);
    `);
  }
  const child = spawn("sh", [path.resolve("docker-entrypoint.sh")], {
    cwd: dir, detached: true, stdio: "ignore",
    env: { ...process.env, RUN_MIGRATIONS_ON_START: "false", SEED_ON_START: "false" },
  });
  try {
    const exited = once(child, "exit");
    await vi.waitFor(async () => {
      for (const name of services) expect(await readFile(path.join(dir, name + ".ready"), "utf8")).toBe("ready");
    }, { timeout: 5000 });
    child.kill("SIGTERM");
    expect(await exited).toEqual([0, null]);
    for (const name of services) expect(await readFile(path.join(dir, name + ".done"), "utf8")).toBe("done");
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) process.kill(-child.pid, "SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
}, 12_000);
