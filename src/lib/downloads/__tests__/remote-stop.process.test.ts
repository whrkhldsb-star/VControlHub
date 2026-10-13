// @vitest-environment node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  buildDirectDownloadCommand,
  buildDirectDownloadStopCommand,
  parseDirectDownloadStopResult,
} from "../remote-command";

/**
 * Real processes, no mocks: the direct-download command is the one the
 * controller runs over SSH (detached bash + curl), here against a local HTTP
 * server that keeps the transfer open. Cancelling must leave no download
 * process behind — not just the bash parent — and must not touch an
 * unrelated process that happens to own the pid in the marker file.
 */
const supported = process.platform === "linux"
  && ["curl", "pgrep", "pkill", "bash"].every((tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0);

describe.skipIf(!supported)("direct download stop command (real bash/curl processes)", () => {
  let server: Server;
  let port: number;
  let targetDir: string;
  const taskIds: string[] = [];

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(1 << 30) });
      const timer = setInterval(() => response.write(Buffer.alloc(16)), 100);
      response.on("close", () => clearInterval(timer));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(() => {
    for (const id of taskIds.splice(0)) {
      spawnSync("pkill", ["-KILL", "-f", `\\.vch-${id}\\.part`]);
      rmSync(`/tmp/app-dl-${id}.pid`, { force: true });
      rmSync(`/tmp/app-dl-${id}.pid.exit`, { force: true });
      rmSync(`/tmp/app-dl-${id}.log`, { force: true });
      rmSync(`/tmp/app-dl-${id}.cancel`, { force: true });
    }
    if (targetDir) rmSync(targetDir, { recursive: true, force: true });
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const downloadProcesses = (id: string) =>
    (spawnSync("pgrep", ["-f", `\\.vch-${id}\\.part`], { encoding: "utf8" }).stdout ?? "").trim().split("\n").filter(Boolean);
  const curlRunning = (id: string) => spawnSync("pgrep", ["-f", `^curl .*\\.vch-${id}\\.part`]).status === 0;
  const runRemote = (command: string) => {
    const result = spawnSync("sh", ["-c", command], { encoding: "utf8", timeout: 30_000 });
    return { stdout: result.stdout, exitCode: result.status };
  };
  async function waitFor(predicate: () => boolean) {
    for (let i = 0; i < 100 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(predicate()).toBe(true);
  }
  async function startDownload() {
    const id = `t${randomUUID().replace(/-/g, "")}`;
    taskIds.push(id);
    targetDir = mkdtempSync(join(tmpdir(), "vch-dl-stop-"));
    const command = buildDirectDownloadCommand({
      taskId: id,
      url: `http://127.0.0.1:${port}/big.bin`,
      targetPath: targetDir,
      fileName: "big.bin",
      sourceResolution: { hostname: "127.0.0.1", address: "127.0.0.1", port: port as 80 },
    });
    const pid = Number(runRemote(command).stdout.trim());
    expect(pid).toBeGreaterThan(0);
    await waitFor(() => curlRunning(id) && readdirSync(targetDir).some((name) => name.endsWith(`.vch-${id}.part`)));
    return { id, pid };
  }

  it("stops the detached bash AND its curl, removes the staging file and markers", async () => {
    const { id } = await startDownload();
    const result = runRemote(buildDirectDownloadStopCommand(id, targetDir));
    expect(parseDirectDownloadStopResult(result)).toBe("STOPPED");
    expect(downloadProcesses(id)).toEqual([]);
    expect(curlRunning(id)).toBe(false);
    expect(readdirSync(targetDir)).toEqual([]);
    expect(existsSync(`/tmp/app-dl-${id}.pid`)).toBe(false);
  });

  it("finds the download without the pid (controller died before storing it)", async () => {
    const { id } = await startDownload();
    rmSync(`/tmp/app-dl-${id}.pid`, { force: true });
    expect(parseDirectDownloadStopResult(runRemote(buildDirectDownloadStopCommand(id, targetDir)))).toBe("STOPPED");
    expect(curlRunning(id)).toBe(false);
  });

  it("stops an orphaned curl whose bash parent is already gone", async () => {
    const { id, pid } = await startDownload();
    execFileSync("kill", ["-KILL", String(pid)]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(curlRunning(id)).toBe(true);
    expect(parseDirectDownloadStopResult(runRemote(buildDirectDownloadStopCommand(id, targetDir)))).toBe("STOPPED");
    expect(curlRunning(id)).toBe(false);
  });

  it("reports NOT_RUNNING when nothing is left and never kills an unrelated process holding the marker pid", async () => {
    const id = `t${randomUUID().replace(/-/g, "")}`;
    taskIds.push(id);
    targetDir = mkdtempSync(join(tmpdir(), "vch-dl-stop-"));
    const unrelated = spawn("sleep", ["30"], { stdio: "ignore" });
    try {
      writeFileSync(`/tmp/app-dl-${id}.pid`, `${unrelated.pid}\n`);
      expect(parseDirectDownloadStopResult(runRemote(buildDirectDownloadStopCommand(id, targetDir)))).toBe("NOT_RUNNING");
      expect(unrelated.exitCode).toBeNull();
      expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    } finally {
      unrelated.kill("SIGKILL");
    }
  });

  it("a cancel that found nothing still wins against a spawn that starts right after it (worker dies before recording the pid)", async () => {
    const id = `t${randomUUID().replace(/-/g, "")}`;
    taskIds.push(id);
    targetDir = mkdtempSync(join(tmpdir(), "vch-dl-stop-"));
    // The cancel runs first and finds no process: the task becomes CANCELLED.
    expect(parseDirectDownloadStopResult(runRemote(buildDirectDownloadStopCommand(id, targetDir, { cancel: true })))).toBe("NOT_RUNNING");
    // The worker's spawn was already in flight and lands now; the worker then
    // dies, so nobody runs the worker-side stop.
    runRemote(buildDirectDownloadCommand({
      taskId: id,
      url: `http://127.0.0.1:${port}/big.bin`,
      targetPath: targetDir,
      fileName: "big.bin",
      sourceResolution: { hostname: "127.0.0.1", address: "127.0.0.1", port: port as 80 },
    }));
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(curlRunning(id)).toBe(false);
    expect(downloadProcesses(id)).toEqual([]);
    expect(readdirSync(targetDir)).toEqual([]);
  });

  it("treats a failed or unparseable stop as unconfirmed", () => {
    expect(parseDirectDownloadStopResult({ stdout: "STILL_RUNNING\n", exitCode: 4 })).toBeNull();
    expect(parseDirectDownloadStopResult({ stdout: "", exitCode: 0 })).toBeNull();
    expect(parseDirectDownloadStopResult({ stdout: "STOPPED\n", exitCode: null })).toBeNull();
  });
});
