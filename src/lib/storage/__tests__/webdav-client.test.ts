// @vitest-environment node
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWebDavClient, type WebDavTransport } from "../webdav-client";
import { encryptWebDavConfig, resolveStorageWebDavCredentials, validateWebDavConfig } from "../webdav-credentials";

const config = { endpoint: "https://dav.example.com/dav/", authType: "basic" as const, username: "alice", password: "secret-password" };
let server: Server;
let origin: string;
let fallbackClosed = false;
const objects = new Map<string, Buffer | null>([["/dav/root", null]]);
const requests: Array<{ method: string; auth?: string; destination?: string }> = [];
const transport: WebDavTransport = async (url, init) => fetch(origin + url.pathname, { ...init, redirect: "manual" });
const client = () => createWebDavClient({ basePath: "/root", webdavConfigEncrypted: encryptWebDavConfig(config) }, { transport });
beforeAll(async () => {
  process.env.ENCRYPTION_KEY = "webdav-fixture-key";
  server = createServer(async (req, res) => {
    const key = decodeURIComponent(req.url!.replace(/\/$/, ""));
    requests.push({ method: req.method!, auth: req.headers.authorization, destination: req.headersDistinct.destination?.[0] });
    if (key.endsWith("/denied")) { res.writeHead(401); res.end("secret-password provider error"); return; }
    if (key.endsWith("/redirect")) { res.writeHead(302, { Location: "http://127.0.0.1/private" }); res.end(); return; }
    if (req.method === "GET" && key.includes("/range-")) {
      if (req.headers.range !== "bytes=3-6" || !(req.headers["accept-encoding"] ?? "").split(",").every((value) => value.trim() === "identity")) { res.writeHead(400); res.end(); return; }
      const mode = key.split("/range-")[1];
      if (mode === "ignored" || mode === "fallback-short") { res.writeHead(200); res.end(mode === "ignored" ? "0123456789" : "01234"); return; }
      if (mode === "fallback-cancel") {
        res.writeHead(200); res.write("0123456");
        req.on("close", () => { fallbackClosed = true; });
        return;
      }
      const contentRange = ({ valid: "bytes 3-6/10", wrong: "bytes 0-3/10", total: "bytes 3-6/11", unknown: "bytes 3-6/*", invalid: "bytes 3-10/10", short: "bytes 3-6/10", long: "bytes 3-6/10" } as Record<string, string>)[mode!];
      res.writeHead(206, contentRange ? { "Content-Range": contentRange } : {});
      res.end(mode === "short" ? "34" : mode === "long" ? "34567" : "3456"); return;
    }
    if (req.method === "PUT") { const chunks = []; for await (const c of req) chunks.push(c); objects.set(key, Buffer.concat(chunks)); res.writeHead(201); }
    else if (req.method === "MKCOL") { objects.set(key, null); res.writeHead(201); }
    else if (!objects.has(key)) res.writeHead(404);
    else if (req.method === "GET") { res.writeHead(200); res.end(objects.get(key)); return; }
    else if (req.method === "DELETE") { objects.delete(key); res.writeHead(204); }
    else if (req.method === "MOVE") { const target = decodeURIComponent(new URL(req.headersDistinct.destination?.[0] ?? 'https://invalid.example/').pathname); objects.set(target, objects.get(key)!); objects.delete(key); res.writeHead(201); }
    else if (req.method === "PROPFIND") {
      const rows = [...objects].filter(([p]) => p === key || (req.headers.depth === "1" && p.startsWith(key + "/") && !p.slice(key.length + 1).includes("/")));
      res.writeHead(207, { "Content-Type": "application/xml" });
      res.end(`<d:multistatus xmlns:d="DAV:">${rows.map(([p, b]) => `<d:response><d:href>${encodeURI(p)}</d:href><d:propstat><d:prop><d:resourcetype>${b === null ? "<d:collection/>" : ""}</d:resourcetype><d:getcontentlength>${b?.length ?? 0}</d:getcontentlength><d:getlastmodified>Sat, 05 Sep 2026 00:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("")}</d:multistatus>`); return;
    } else res.writeHead(405);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("WebDAV actual HTTP adapter", () => {
  it.each(["valid", "ignored"])("streams requested bytes with %s provider Range support", async (mode) => {
    expect(await new Response(await client().stream(`range-${mode}`, { start: 3, end: 6 }, 10)).text()).toBe("3456");
  });
  it("cancels an unfinished 200 response once selected bytes arrive", async () => {
    expect(await new Response(await client().stream("range-fallback-cancel", { start: 3, end: 6 }, 10)).text()).toBe("3456");
    await vi.waitFor(() => expect(fallbackClosed).toBe(true));
  });
  it.each(["wrong", "total", "unknown", "invalid", "missing", "short", "long", "fallback-short"])("rejects malformed or inconsistent 206: %s", async (mode) => {
    await expect((async () => new Response(await client().stream(`range-${mode}`, { start: 3, end: 6 }, 10)).text())()).rejects.toThrow(/WebDAV/);
  });
  it("round trips mkdir/write/list/stat/read/stream/rename/delete against local fixture", async () => {
    const dav = client();
    await dav.mkdir("folder");
    await dav.write("folder/hello 中.txt", Buffer.from("hello world"));
    expect(await dav.list("folder")).toMatchObject([{ name: "hello 中.txt", relativePath: "folder/hello 中.txt", size: 11, isDirectory: false }]);
    expect(await dav.stat("folder/hello 中.txt")).toMatchObject({ size: 11 });
    expect((await dav.read("folder/hello 中.txt", 11)).toString()).toBe("hello world");
    await expect(dav.read("folder/hello 中.txt", 5)).rejects.toThrow(/too large/i);
    const stream = await dav.stream("folder/hello 中.txt");
    expect(await new Response(stream).text()).toBe("hello world");
    await dav.rename("folder/hello 中.txt", "folder/moved.txt");
    await dav.delete("folder/moved.txt");
    expect(await dav.stat("folder/moved.txt")).toBeNull();
    expect(requests.some((r) => r.auth === `Basic ${Buffer.from("alice:secret-password").toString("base64")}`)).toBe(true);
  });
  it("maps errors without leaking credentials and refuses redirects", async () => {
    await expect(client().read("denied")).rejects.toThrow("WebDAV HTTP 401");
    await expect(client().read("denied")).rejects.not.toThrow("secret-password");
    await expect(client().read("redirect")).rejects.toThrow("WebDAV HTTP 302");
  });
  it("supports bearer credentials", async () => {
    const dav = createWebDavClient({ basePath: "root", webdavConfigEncrypted: encryptWebDavConfig({ endpoint: config.endpoint, authType: "bearer", token: "opaque-token" }) }, { transport });
    await dav.list();
    expect(requests.at(-1)?.auth).toBe("Bearer opaque-token");
  });
  it.each(["../escape", "a/../../escape", "%2e%2e/escape", "a%2fb", "a\\b", "a\u0000b"])("rejects unsafe path %s before transport", async (path) => {
    const before = requests.length;
    await expect(client().read(path)).rejects.toThrow(/path/i);
    expect(requests).toHaveLength(before);
  });
  it("rejects private DNS with production transport", async () => {
    const dav = createWebDavClient({ basePath: "root", webdavConfigEncrypted: encryptWebDavConfig({ ...config, endpoint: "https://127.0.0.1.nip.io/dav" }) });
    await expect(dav.list()).rejects.toThrow(/WebDAV/);
  });
});
describe("WebDAV encrypted configuration", () => {
  it("encrypts and resolves without accepting plaintext", () => {
    const encrypted = encryptWebDavConfig(config);
    expect(encrypted).not.toContain("secret-password");
    expect(resolveStorageWebDavCredentials({ webdavConfigEncrypted: encrypted })).toMatchObject(config);
    expect(() => resolveStorageWebDavCredentials({ webdavConfigEncrypted: JSON.stringify(config) })).toThrow(/configuration/i);
  });
  it.each(["http://dav.example.com", "https://u:p@dav.example.com", "https://dav.example.com/#x", "https://dav.example.com/#", "https://127.0.0.1", "https://[::1]", "https://dav.example.com/?token=x"])("rejects endpoint %s", (endpoint) => {
    expect(() => validateWebDavConfig({ ...config, endpoint })).toThrow();
  });
});
