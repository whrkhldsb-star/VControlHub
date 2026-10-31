// @vitest-environment node
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createWebDavClient as realClient } from "@/lib/storage/webdav-client";
import { encryptWebDavConfig } from "@/lib/storage/webdav-credentials";
import { customerSession, routeSession } from "@/test/route-session-mock";

const state = vi.hoisted(() => ({ origin: "", node: {} as Record<string, unknown>, name: "clip.mp4" }));
vi.mock("@/lib/auth/api-session", async () => {
  const { NextResponse } = await import("next/server");
  return {
    getApiSession: async () => routeSession.current,
    requireApiSession: async () => routeSession.current ?? NextResponse.json({}, { status: 401 }),
    isSessionPayload: (value: unknown) => !(value instanceof Response),
  };
});
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: async () => ({ allowed: true }) }));
vi.mock("@/lib/media/service", () => ({ getMediaItem: async () => ({ id: "m", name: state.name, mimeType: "video/mp4", relativePath: state.name, storageNode: state.node }) }));
vi.mock("@/lib/storage/webdav-client", async (original) => {
  const actual = await original<typeof import("@/lib/storage/webdav-client")>();
  return { ...actual, createWebDavClient: (node: Parameters<typeof realClient>[0]) => actual.createWebDavClient(node, { transport: (url, init) => fetch(state.origin + url.pathname, init) }) };
});
import { GET } from "../[id]/stream/route";
let server: Server;
const requests: string[] = [];
beforeAll(async () => {
  routeSession.current = customerSession(["storage:read"]);
  state.node = { id: "node", driver: "WEBDAV", basePath: "root", webdavConfigEncrypted: encryptWebDavConfig({ endpoint: "https://dav.example.com/dav/", authType: "bearer", token: "fixture-only" }) };
  server = createServer((req, res) => {
    requests.push(`${req.method}:${req.headers.range ?? "full"}`);
    const name = req.url!.split("/").at(-1)!;
    const body = name === "empty.mp4" ? "" : "0123456789";
    if (req.method === "PROPFIND") {
      res.writeHead(207, { "Content-Type": "application/xml" });
      res.end(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/root/${name}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${body.length}</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
    } else {
      // Deliberately ignore Range: the real adapter must safely slice 200.
      res.writeHead(200, { "Content-Length": body.length }); res.end(body);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
it("composes the media route with the real WebDAV HTTP adapter including empty bodies and range fallback", async () => {
  const get = (headers: Record<string, string> = {}, suffix = "") => GET(new Request(`http://local/api/media/m/stream${suffix}`, { headers }), { params: Promise.resolve({ id: "m" }) });
  const full = await get(); expect(full.status).toBe(200); expect(await full.text()).toBe("0123456789");
  expect(requests).toContain("GET:full");
  const range = await get({ range: "bytes=3-6" }); expect(range.status).toBe(206); expect(await range.text()).toBe("3456");
  expect(range.headers.get("content-range")).toBe("bytes 3-6/10");
  const download = await get({}, "?download=1"); expect(download.headers.get("content-disposition")).toContain("attachment"); await download.text();
  state.name = "empty.mp4";
  const empty = await get(); expect(empty.status).toBe(200); expect(await empty.text()).toBe("");
  expect(empty.headers.get("content-length")).toBe("0");
  expect((await get({ range: "bytes=0-1" })).status).toBe(416);
});
