// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
const dav = vi.hoisted(() => ({ stat: vi.fn(), stream: vi.fn() }));
vi.mock("../webdav-client", () => ({ createWebDavClient: () => dav }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { streamStorageFile } from "../file-content";

describe("WebDAV file content Range delegation", () => {
  it("passes remote range and stat size without slicing the partial body again", async () => {
    dav.stat.mockResolvedValue({ size: 10, isDirectory: false });
    dav.stream.mockResolvedValue(new Response("3456").body);
    const result = await streamStorageFile({ id: "dav", driver: "WEBDAV", basePath: "root" }, "file", { start: 3, end: 6 });
    const chunks = [];
    for await (const chunk of result.stream as import("node:stream").Readable) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("3456");
    expect(result.size).toBe(10);
    expect(dav.stream).toHaveBeenCalledWith("file", { start: 3, end: 6 }, 10);
    result.close();
  });
});
