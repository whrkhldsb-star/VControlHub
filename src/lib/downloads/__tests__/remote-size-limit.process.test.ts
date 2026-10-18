// @vitest-environment node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildDirectDownloadCommand } from "../remote-command";

/**
 * Real bash and curl: a direct download is held to the creator's storage
 * limit on the VPS itself, whether or not the server announces the size, and
 * a file over it is never published into the target folder.
 */
const supported = process.platform === "linux"
  && ["curl", "bash", "wc"].every((tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0);

describe.skipIf(!supported)("direct download size limit (real bash/curl processes)", () => {
  let server: Server;
  let port: number;
  let targetDir: string;
  const taskIds: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      const body = Buffer.alloc(request.url === "/small.bin" ? 1_000 : 4_096, 1);
      // /chunked.bin does not announce its size, so curl cannot refuse it up front.
      response.writeHead(200, request.url === "/chunked.bin"
        ? { "content-type": "application/octet-stream" }
        : { "content-type": "application/octet-stream", "content-length": String(body.length) });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(() => {
    for (const id of taskIds.splice(0)) {
      for (const suffix of [".pid", ".pid.exit", ".log", ".cancel"]) rmSync(`/tmp/app-dl-${id}${suffix}`, { force: true });
    }
    if (targetDir) rmSync(targetDir, { recursive: true, force: true });
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  async function download(file: string, maxBytes: bigint | null) {
    const id = `t${randomUUID().replace(/-/g, "")}`;
    taskIds.push(id);
    targetDir = mkdtempSync(join(tmpdir(), "vch-dl-limit-"));
    spawnSync("sh", ["-c", buildDirectDownloadCommand({
      taskId: id,
      url: `http://127.0.0.1:${port}/${file}`,
      targetPath: targetDir,
      fileName: file,
      sourceResolution: { hostname: "127.0.0.1", address: "127.0.0.1", port: port as 80 },
      maxBytes,
    })], { encoding: "utf8", timeout: 30_000 });
    const exitFile = `/tmp/app-dl-${id}.pid.exit`;
    for (let i = 0; i < 200 && !existsSync(exitFile); i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    return { status: Number(readFileSync(exitFile, "utf8").trim()), files: readdirSync(targetDir), log: readFileSync(`/tmp/app-dl-${id}.log`, "utf8") };
  }

  it("publishes a file within the limit", async () => {
    await expect(download("small.bin", BigInt(2_048))).resolves.toMatchObject({ status: 0, files: ["small.bin"] });
  });

  it("refuses an announced file over the limit before writing it", async () => {
    const result = await download("big.bin", BigInt(2_048));
    expect(result.status).not.toBe(0);
    expect(result.files).toEqual([]);
  });

  it("discards an unannounced file once it turns out to be over the limit", async () => {
    const result = await download("chunked.bin", BigInt(2_048));
    expect(result.status).toBe(63);
    expect(result.files).toEqual([]);
    // curl 8.4+ stops mid-transfer itself (63); older curl finishes and the script's own check refuses it.
    expect(result.log).toMatch(/maximum allowed file size|larger than the storage limit/);
  });

  it("has no limit without one", async () => {
    await expect(download("chunked.bin", null)).resolves.toMatchObject({ status: 0, files: ["chunked.bin"] });
  });
});
