// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), destroy: vi.fn(), options: null as unknown }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", () => ({ fetch: mocks.fetch, Agent: class { constructor(options: unknown) { mocks.options = options; } destroy = mocks.destroy; } }));
import { createWebDavClient } from "../webdav-client";
import { encryptWebDavConfig } from "../webdav-credentials";
const node = () => ({ basePath: "root", webdavConfigEncrypted: encryptWebDavConfig({ endpoint: "https://dav.example.com/dav", authType: "bearer", token: "secret-token" }) });
beforeEach(() => { vi.clearAllMocks(); process.env.ENCRYPTION_KEY = "security-fixture-key"; mocks.destroy.mockResolvedValue(undefined); mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); mocks.fetch.mockResolvedValue(new Response("ok")); });
describe("WebDAV pinned TLS transport", () => {
  it("pins exact validated DNS answer, requires TLS verification and disables redirects", async () => {
    expect((await createWebDavClient(node()).read("x")).toString()).toBe("ok");
    const options = mocks.options as { connect: { rejectUnauthorized: boolean; lookup: (host: string, options: object, callback: (...args: unknown[]) => void) => void } };
    expect(options.connect.rejectUnauthorized).toBe(true);
    const cb = vi.fn(); options.connect.lookup("dav.example.com", { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }], undefined);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
    expect(mocks.destroy).toHaveBeenCalled();
  });
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::"])("rejects DNS address %s before connecting", async (address) => {
    mocks.lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
    await expect(createWebDavClient(node()).read("x")).rejects.toThrow(/DNS policy/);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("rejects mixed public/private DNS", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(createWebDavClient(node()).read("x")).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("sanitizes TLS/transport failures", async () => {
    mocks.fetch.mockRejectedValue(new Error("secret-token https://provider/private"));
    await expect(createWebDavClient(node()).read("x")).rejects.toThrow("WebDAV connection, DNS policy or TLS verification failed");
    expect(mocks.destroy).toHaveBeenCalled();
  });
  it("rejects XML entities and out-of-root hrefs", async () => {
    for (const xml of ['<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><multistatus/>', '<multistatus><response><href>/elsewhere/x</href></response></multistatus>', '<multistatus><response><href>https://evil.example/dav/root/x</href></response></multistatus>']) {
      const dav = createWebDavClient(node(), { transport: async () => new Response(xml, { status: 207 }) });
      await expect(dav.list()).rejects.toThrow(/WebDAV/);
    }
  });
  it("bounds chunked reads and cancels stream", async () => {
    const cancel = vi.fn();
    const dav = createWebDavClient(node(), { transport: async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(10)); }, cancel })) });
    await expect(dav.read("x", 5)).rejects.toThrow(/too large/);
    expect(cancel).toHaveBeenCalled();
  });
  it("does not treat partial multistatus deletion as success", async () => {
    const dav = createWebDavClient(node(), { transport: async () => new Response("<multistatus/>", { status: 207 }) });
    await expect(dav.delete("x")).rejects.toThrow(/partial multistatus/);
  });
});
