// @vitest-environment node
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWebDavClient, type WebDavTransport } from "../webdav-client";
import { encryptWebDavConfig } from "../webdav-credentials";

let server: Server;
let origin: string;
let closed = 0;
let token = "first-fixture-token";
const copiedFiles = new Map<string, Buffer>([["/root/copy-source.bin", Buffer.from([0, 128, 255, 1])]]);
const bodies: ReadableStream<Uint8Array>[] = [];
const transport: WebDavTransport = async (url, init) => {
  const response = await fetch(origin + url.pathname, init);
  if (response.body) bodies.push(response.body);
  return response;
};
const client = (credential = token) => createWebDavClient({ basePath: "root", webdavConfigEncrypted: encryptWebDavConfig({
  endpoint: "https://dav.example.com", authType: "bearer", token: credential,
}) }, { transport });

beforeAll(async () => {
  vi.stubEnv("ENCRYPTION_KEY", "webdav-lifecycle-fixture-key");
  server = createServer((request, response) => {
    response.on("close", () => { closed += 1; });
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401); response.end("credential rejected"); return; }
    if (request.method === "COPY") {
      if (request.headers.depth !== "0" || request.headers.overwrite !== "F") { response.writeHead(400); response.end(); return; }
      if (request.url === "/root/partial-copy") { response.writeHead(207); response.end("partial"); return; }
      const destination = new URL(String(request.headers.destination)).pathname;
      const source = copiedFiles.get(request.url!);
      if (!source) { response.writeHead(404); response.end(); return; }
      if (copiedFiles.has(destination)) { response.writeHead(412); response.end(); return; }
      copiedFiles.set(destination, Buffer.from(source));
      response.writeHead(201); response.end(); return;
    }
    if (copiedFiles.has(request.url!)) { response.end(copiedFiles.get(request.url!)); return; }
    if (request.url === "/root/headers-stall") return;
    if (request.url === "/root/hold") { response.writeHead(200); response.write("first chunk"); return; }
    if (request.url === "/root/drop") {
      response.writeHead(200, { "Content-Length": "100" });
      response.write("partial");
      setImmediate(() => response.destroy());
      return;
    }
    response.end("complete");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
});

describe("WebDAV real HTTP lifecycle", () => {
  it("copies binary bytes with native COPY and refuses to overwrite an existing destination", async () => {
    await client().copy("copy-source.bin", "copy target.bin");
    expect(await client().read("copy target.bin")).toEqual(Buffer.from([0, 128, 255, 1]));
    await expect(client().copy("copy-source.bin", "copy target.bin")).rejects.toThrow("412");
    expect(await client().read("copy-source.bin")).toEqual(Buffer.from([0, 128, 255, 1]));
  });
  it("rejects a partial multistatus COPY response", async () => {
    await expect(client().copy("partial-copy", "target.bin")).rejects.toThrow(/partial/i);
  });
  it("releases each upstream reader after repeated completed transfers", async () => {
    for (let index = 0; index < 20; index++) {
      expect(await new Response(await client().stream("complete")).text()).toBe("complete");
    }
    expect(bodies.every((body) => !body.locked)).toBe(true);
  });
  it("disconnects and releases a transfer when its consumer cancels", async () => {
    const before = closed;
    const stream = await client().stream("hold");
    const reader = stream.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    reader.releaseLock();
    await vi.waitFor(() => expect(closed).toBeGreaterThan(before));
    expect(bodies.at(-1)?.locked).toBe(false);
  });
  it("rejects interrupted responses and allows a fresh retry", async () => {
    await expect(client().read("drop")).rejects.toThrow(/WebDAV/);
    expect((await client().read("complete")).toString()).toBe("complete");
  });
  it("aborts a real connection stuck before response headers", async () => {
    const setTimer = globalThis.setTimeout;
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((...args: Parameters<typeof setTimeout>) => {
      const [callback, timeout, ...rest] = args;
      return setTimer(callback, timeout === 120_000 ? 50 : timeout, ...rest);
    }) as typeof setTimeout);
    try {
      await expect(client().read("headers-stall")).rejects.toThrow(/WebDAV connection/);
    } finally { timer.mockRestore(); }
  });
  it("uses rotated credentials without reusing a rejected authorization header", async () => {
    const stale = client();
    token = "second-fixture-token";
    await expect(stale.read("complete")).rejects.toThrow("WebDAV HTTP 401");
    expect((await client().read("complete")).toString()).toBe("complete");
  });
});
