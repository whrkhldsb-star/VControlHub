// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
const dav = vi.hoisted(() => ({ stat: vi.fn(), stream: vi.fn(), writeStream: vi.fn(), rename: vi.fn(), delete: vi.fn(async () => {}) }));
vi.mock("../webdav-client", () => ({ createWebDavClient: () => dav }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { streamStorageFile, writeStorageFileFromLocalPath } from "../file-content";

describe("WebDAV file content Range delegation", () => {
  it("passes remote range and stat size without slicing the partial body again", async () => {
    dav.stat.mockResolvedValue({ size: 10, isDirectory: false, etag: '"version-1"' });
    dav.stream.mockResolvedValue(new Response("3456").body);
    const result = await streamStorageFile({ id: "dav", driver: "WEBDAV", basePath: "root", host: null, port: null, username: null, hostKeySha256: null, server: null }, "file", { start: 3, end: 6 });
    const chunks = [];
    for await (const chunk of result.stream as import("node:stream").Readable) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("3456");
    expect(result.size).toBe(10);
    expect(dav.stream).toHaveBeenCalledWith("file", { start: 3, end: 6 }, 10, '"version-1"');
    result.close();
  });
});

it("refuses the final overwrite when an upstream collection appeared during staging", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "webdav-collection-"));
  const source = path.join(directory, "upload");
  try {
    await writeFile(source, "new");
    dav.writeStream.mockImplementation(async (_path, body) => { await new Response(body).arrayBuffer(); });
    dav.stat.mockResolvedValue({ isDirectory: true });
    const node = { id: "dav", driver: "WEBDAV", basePath: "root", host: null, port: null, username: null, hostKeySha256: null, server: null };
    await expect(writeStorageFileFromLocalPath(node, "target", source)).rejects.toMatchObject({ status: 409 });
    expect(dav.rename).not.toHaveBeenCalled();
    expect(dav.delete).toHaveBeenCalledWith(expect.stringMatching(/^\.vch-upload-.*\.tmp$/));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
