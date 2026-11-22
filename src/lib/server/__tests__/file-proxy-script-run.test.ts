/** @vitest-environment node */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildFileProxyScript, fileProxyProcessCommand, startFileProxyCommand } from "../file-proxy-script";

const hasPython = spawnSync("python3", ["--version"]).status === 0 && process.platform !== "win32";
const itPython = hasPython ? it : it.skip;

/** Raw HTTP so a body sent after a HEAD response is visible. */
function rawRequest(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.end(request));
    let data = "";
    socket.on("data", (chunk) => { data += chunk.toString("latin1"); });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}

describe("file proxy script (run with python3)", () => {
  let root = "";
  let proxy: ChildProcess | undefined;
  afterEach(async () => {
    proxy?.kill();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function start() {
    root = await mkdtemp(path.join(os.tmpdir(), "file-proxy-"));
    const real = path.join(root, "disk", "files");
    await mkdir(real, { recursive: true });
    await writeFile(path.join(real, "a%20b.txt"), "literal percent name");
    await writeFile(path.join(real, "keep.txt"), "keep body");
    await writeFile(path.join(real, "page.html"), "<script>alert(1)</script>");
    await writeFile(path.join(real, "doc.pdf"), "%PDF-1.4");
    // The bound storage root is a link to the disk (e.g. /data -> /mnt/disk).
    const serveDir = path.join(root, "files-link");
    await symlink(real, serveDir);
    const script = buildFileProxyScript({ accessToken: "tok", expiresAtMs: Date.now() + 600_000, serveDir, port: 0, allowedOrigin: "" });
    proxy = spawn("python3", ["-c", script], { stdio: ["ignore", "pipe", "pipe"] });
    return new Promise<number>((resolve, reject) => {
      proxy!.stdout!.on("data", (chunk: Buffer) => {
        const match = /PROXY_READY:(\d+)/.exec(chunk.toString());
        if (match) resolve(Number(match[1]));
      });
      proxy!.on("exit", (code) => reject(new Error(`proxy exited ${code}`)));
    });
  }

  it.skipIf(!hasPython || process.platform !== "linux")("writes mode 0600 before release and confirms termination on the target", async () => {
    const script = buildFileProxyScript({ accessToken: "private-test-token", expiresAtMs: Date.now() + 60_000, serveDir: "/tmp", port: 0, allowedOrigin: "" });
    const launch = spawnSync("sh", ["-c", `umask 022\n${startFileProxyCommand}`], { input: script, encoding: "utf8" });
    expect(launch.status).toBe(0);
    const [pid, dir] = launch.stdout.trim().split(" ");
    expect(dir).toMatch(/^\/tmp\/\.vps_file_proxy_[a-zA-Z0-9]{10}$/);
    root = dir!;
    const check = (stop: boolean) => spawnSync("sh", ["-c", fileProxyProcessCommand(Number(pid), stop)], { encoding: "utf8" });
    try {
      expect((await stat(root)).mode & 0o777).toBe(0o700);
      expect((await stat(path.join(root, "proxy.py"))).mode & 0o777).toBe(0o600);
      expect((await stat(path.join(root, "proxy.out"))).mode & 0o777).toBe(0o600);
      expect(await readFile(path.join(root, "proxy.py"), "utf8")).toContain("private-test-token");
      expect(check(false).stdout.trim()).toBe("proxy_running");
      expect(await readFile(path.join(root, "proxy.out"), "utf8")).toBe("");
      await writeFile(path.join(root, "start"), "");
      await expect.poll(() => readFile(path.join(root, "proxy.out"), "utf8")).toMatch(/^PROXY_READY:/);
      expect(check(true).stdout.trim()).toBe("not_running");
      expect(check(false).stdout.trim()).toBe("not_running");
    } finally {
      check(true);
    }
  });

  itPython("serves files below a linked root, including names with a literal %XX", async () => {
    const port = await start();
    const keep = await rawRequest(port, "GET /keep.txt HTTP/1.0\r\nX-VControlHub-Proxy-Token: tok\r\n\r\n");
    expect(keep).toMatch(/^HTTP\/1\.0 200/);
    expect(keep).toContain("keep body");
    // The file is literally "a%20b.txt": its URL quotes the percent sign.
    const percent = await rawRequest(port, "GET /a%2520b.txt HTTP/1.0\r\nX-VControlHub-Proxy-Token: tok\r\n\r\n");
    expect(percent).toMatch(/^HTTP\/1\.0 200/);
    expect(percent).toContain("literal percent name");
  });

  itPython("answers HEAD with headers only", async () => {
    const port = await start();
    const head = await rawRequest(port, "HEAD /keep.txt HTTP/1.0\r\nX-VControlHub-Proxy-Token: tok\r\n\r\n");
    expect(head).toMatch(/^HTTP\/1\.0 200/);
    expect(head).toMatch(/Content-Length: 9/i);
    expect(head).not.toContain("keep body");
  });

  itPython("sandboxes non-PDF responses and forces attachment for active markup", async () => {
    const port = await start();
    const html = await rawRequest(port, "GET /page.html HTTP/1.0\r\nX-VControlHub-Proxy-Token: tok\r\n\r\n");
    expect(html).toMatch(/^HTTP\/1\.0 200/);
    expect(html).toMatch(/X-Content-Type-Options: nosniff/i);
    expect(html).toMatch(/Referrer-Policy: no-referrer/i);
    expect(html).toMatch(/Content-Security-Policy: sandbox/i);
    expect(html).toMatch(/Content-Disposition: attachment/i);

    const pdf = await rawRequest(port, "GET /doc.pdf HTTP/1.0\r\nX-VControlHub-Proxy-Token: tok\r\n\r\n");
    expect(pdf).toMatch(/^HTTP\/1\.0 200/);
    expect(pdf).toMatch(/X-Content-Type-Options: nosniff/i);
    expect(pdf).toMatch(/Referrer-Policy: no-referrer/i);
    expect(pdf).not.toMatch(/Content-Security-Policy: sandbox/i);
    expect(pdf).not.toMatch(/Content-Disposition: attachment/i);
  });
});
