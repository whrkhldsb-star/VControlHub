// @vitest-environment node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { handleWebDavCopy, handleWebDavDelete, handleWebDavMove, handleWebDavPut } from "../handler";
import { buildWebDavHref } from "../handler-internals";

/**
 * WebDAV MOVE / COPY / PUT against a real LOCAL storage directory and a real
 * PostgreSQL index (whose unique (storageNodeId, relativePath) includes
 * recycle-bin rows). File-manager deletes are index-only: a recycled file's
 * bytes stay at their path until purged, so any WebDAV write there must either
 * keep them or refuse — and an Overwrite:T MOVE must actually work.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("WebDAV MOVE/COPY/PUT with recycle-bin rows", () => {
  const prefix = `webdav-${randomUUID()}`;
  const origin = "http://webdav.test";
  let root: string;
  const session = { userId: prefix, username: prefix, roles: ["admin" as const], mustChangePassword: false, currentTeamId: null };

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash" } });
  });
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "vch-webdav-"));
    await prisma.storageNode.create({ data: { id: prefix, name: prefix, driver: "LOCAL", basePath: root } });
  });
  afterEach(async () => {
    await prisma.shareLink.deleteMany({ where: { storageNodeId: prefix } }).catch(() => undefined);
    await prisma.fileVersion.deleteMany({ where: { fileEntry: { storageNodeId: prefix } } }).catch(() => undefined);
    await prisma.fileEntry.deleteMany({ where: { storageNodeId: prefix } });
    await prisma.storageNode.deleteMany({ where: { id: prefix } });
    rmSync(root, { recursive: true, force: true });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  async function file(relativePath: string, content: string, deleted = false) {
    const absolute = join(root, relativePath);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content);
    return prisma.fileEntry.create({
      data: { storageNodeId: prefix, relativePath, name: relativePath.split("/").pop()!, entryType: "FILE", size: BigInt(content.length), isDeleted: deleted, deleteBatchId: deleted ? randomUUID() : null },
    });
  }
  async function dir(relativePath: string, deleted = false) {
    mkdirSync(join(root, relativePath), { recursive: true });
    return prisma.fileEntry.create({ data: { storageNodeId: prefix, relativePath, name: relativePath.split("/").pop()!, entryType: "DIRECTORY", isDeleted: deleted } });
  }
  const ctx = (relativePath: string) => ({ session, storageNodeId: prefix, relativePath, requestUrl: new URL(`${origin}${buildWebDavHref(prefix, relativePath, false)}`) });
  const request = (method: string, destination: string, overwrite = "T", body?: string) =>
    new Request(`${origin}/x`, { method, body, headers: { destination: `${origin}${buildWebDavHref(prefix, destination, false)}`, overwrite } });
  const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");
  const status = async (promise: Promise<Response>) => promise.then((response) => response.status, (error: { status?: number }) => error.status ?? 500);

  it("MOVE with Overwrite:T of a file onto a file keeps the destination's entry, the replaced content as a version", async () => {
    // An editor's atomic save (write a temporary file, MOVE it over the
    // original), as PUT and COPY treat an overwrite: the original keeps its
    // entry — versions, favourites, links. Its row used to go to the recycle
    // bin under a tombstone path, never restorable, with its history.
    const source = await file("a.txt", "source bytes");
    const old = await file("b.txt", "old destination bytes");
    expect(await status(handleWebDavMove(ctx("a.txt"), request("MOVE", "b.txt")))).toBe(204);
    expect(read("b.txt")).toBe("source bytes");
    expect(existsSync(join(root, "a.txt"))).toBe(false);
    const rows = await prisma.fileEntry.findMany({ where: { storageNodeId: prefix } });
    expect(rows.map((row) => [row.id, row.relativePath, row.isDeleted, row.size])).toEqual([[old.id, "b.txt", false, BigInt("source bytes".length)]]);
    expect(await prisma.fileEntry.findUnique({ where: { id: source.id } })).toBeNull();
    const versions = await prisma.fileVersion.findMany({ where: { fileEntryId: old.id } });
    expect(versions.map((version) => version.sizeBytes)).toEqual([BigInt("old destination bytes".length)]);
  });

  it("MOVE with Overwrite:F onto a live destination changes nothing", async () => {
    await file("a.txt", "source bytes");
    await file("b.txt", "old destination bytes");
    expect(await status(handleWebDavMove(ctx("a.txt"), request("MOVE", "b.txt", "F")))).toBe(412);
    expect(read("a.txt")).toBe("source bytes");
    expect(read("b.txt")).toBe("old destination bytes");
  });

  it("MOVE onto a recycle-bin file refuses and keeps the recycled bytes", async () => {
    await file("a.txt", "source bytes");
    await file("b.txt", "recycled bytes", true);
    const code = await status(handleWebDavMove(ctx("a.txt"), request("MOVE", "b.txt")));
    expect(read("b.txt")).toBe("recycled bytes");
    expect(read("a.txt")).toBe("source bytes");
    expect(code).toBe(409);
  });

  it("MOVE of a directory over a live directory holding a recycled child refuses and keeps that child", async () => {
    await dir("src");
    await file("src/new.txt", "new");
    await dir("dst");
    await file("dst/keep.txt", "recycled child", true);
    const code = await status(handleWebDavMove(ctx("src"), request("MOVE", "dst")));
    expect(existsSync(join(root, "dst/keep.txt")) && read("dst/keep.txt")).toBe("recycled child");
    expect(read("src/new.txt")).toBe("new");
    expect(code).toBe(409);
  });

  it("MOVE of a directory with children to a new path re-indexes every descendant", async () => {
    const source = await dir("src");
    await file("src/one.txt", "one");
    await file("src/sub/two.txt", "two");
    expect(await status(handleWebDavMove(ctx("src"), request("MOVE", "fresh")))).toBe(201);
    expect(read("fresh/sub/two.txt")).toBe("two");
    const rows = await prisma.fileEntry.findMany({ where: { storageNodeId: prefix }, orderBy: { relativePath: "asc" }, select: { id: true, relativePath: true, name: true } });
    expect(rows.map((row) => [row.relativePath, row.name])).toEqual([["fresh", "fresh"], ["fresh/one.txt", "one.txt"], ["fresh/sub/two.txt", "two.txt"]]);
    expect(rows[0]!.id).toBe(source.id);
  });

  it("MOVE of a directory whose name has an emoji or CJK re-indexes descendants exactly", async () => {
    // JavaScript counts 🚀 as two UTF-16 units, PostgreSQL as one character.
    await dir("🚀 发布");
    await file("🚀 发布/example.txt", "original bytes");
    await file("🚀 发布/子目录/深.txt", "deep");
    expect(await status(handleWebDavMove(ctx("🚀 发布"), request("MOVE", "docs")))).toBe(201);
    expect(read("docs/example.txt")).toBe("original bytes");
    const rows = await prisma.fileEntry.findMany({ where: { storageNodeId: prefix }, orderBy: { relativePath: "asc" }, select: { relativePath: true, name: true } });
    expect(rows.map((row) => [row.relativePath, row.name])).toEqual([["docs", "docs"], ["docs/example.txt", "example.txt"], ["docs/子目录/深.txt", "深.txt"]]);
  });

  it("MOVE of a directory over a live directory moves every child and drops the old tree", async () => {
    const source = await dir("src");
    await file("src/one.txt", "one");
    await file("src/sub/two.txt", "two");
    await dir("dst");
    await file("dst/old.txt", "old");
    expect(await status(handleWebDavMove(ctx("src"), request("MOVE", "dst")))).toBe(204);
    expect(read("dst/one.txt")).toBe("one");
    expect(read("dst/sub/two.txt")).toBe("two");
    expect(existsSync(join(root, "dst/old.txt"))).toBe(false);
    const live = await prisma.fileEntry.findMany({ where: { storageNodeId: prefix, isDeleted: false }, orderBy: { relativePath: "asc" } });
    expect(live.map((row) => row.relativePath)).toEqual(["dst", "dst/one.txt", "dst/sub/two.txt"]);
    expect(live[0]!.id).toBe(source.id);
    // No tombstones of the replaced tree left in the recycle bin.
    expect(await prisma.fileEntry.count({ where: { storageNodeId: prefix, isDeleted: true } })).toBe(0);
  });

  it("DELETE of a directory removes it for good: its rows (recycle-bin ones too), bytes and links", async () => {
    await dir("docs");
    await file("docs/live.txt", "live");
    await file("docs/recycled.txt", "recycled bytes", true);
    await file("other.txt", "untouched");
    const share = (path: string) =>
      prisma.shareLink.create({ data: { tokenHash: `${prefix}-${randomUUID()}`, storageNodeId: prefix, path, entryType: "FILE" } });
    const inside = await share("docs/live.txt");
    const outside = await share("other.txt");

    expect(await status(handleWebDavDelete(ctx("docs")))).toBe(204);

    expect(existsSync(join(root, "docs"))).toBe(false);
    // They used to go to the recycle bin, where nothing could restore them.
    const rows = await prisma.fileEntry.findMany({ where: { storageNodeId: prefix }, select: { relativePath: true } });
    expect(rows.map((row) => row.relativePath)).toEqual(["other.txt"]);
    expect((await prisma.shareLink.findUniqueOrThrow({ where: { id: inside.id } })).revokedAt).not.toBeNull();
    expect((await prisma.shareLink.findUniqueOrThrow({ where: { id: outside.id } })).revokedAt).toBeNull();
    // Nothing is left on disk beside the untouched file (the staged copy is gone too).
    expect(readdirSync(root)).toEqual(["other.txt"]);
  });

  it("COPY onto a recycle-bin file refuses and keeps the recycled bytes", async () => {
    await file("a.txt", "source bytes");
    await file("b.txt", "recycled bytes", true);
    const code = await status(handleWebDavCopy(ctx("a.txt"), request("COPY", "b.txt")));
    expect(existsSync(join(root, "b.txt")) && read("b.txt")).toBe("recycled bytes");
    expect(code).toBe(409);
  });

  it("PUT over a recycle-bin file keeps the recycled bytes as a version and clears the delete batch", async () => {
    const recycled = await file("b.txt", "recycled bytes", true);
    const put = new Request(`${origin}/x`, { method: "PUT", body: "uploaded bytes", headers: { "content-type": "text/plain", "content-length": "14" } });
    expect([201, 204]).toContain(await status(handleWebDavPut(ctx("b.txt"), put)));
    expect(read("b.txt")).toBe("uploaded bytes");
    const row = await prisma.fileEntry.findUniqueOrThrow({ where: { id: recycled.id } });
    expect(row).toMatchObject({ isDeleted: false, deleteBatchId: null });
    const versions = await prisma.fileVersion.findMany({ where: { fileEntryId: recycled.id } });
    expect(versions).toHaveLength(1);
  });
});
