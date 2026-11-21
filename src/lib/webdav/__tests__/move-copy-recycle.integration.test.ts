// @vitest-environment node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { handleWebDavCopy, handleWebDavGetHead, handleWebDavDelete, handleWebDavMove, handleWebDavPropFind, handleWebDavPut } from "../handler";
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

  it("serves ranges and HEAD from the open physical version even when its index is stale", async () => {
    await file("doc.txt", "x");
    writeFileSync(join(root, "doc.txt"), "updated");
    const head = await handleWebDavGetHead(ctx("doc.txt"), "HEAD");
    expect(head.headers.get("content-length")).toBe("7");
    const ranged = await handleWebDavGetHead({ ...ctx("doc.txt"), rangeHeader: "bytes=3-6" }, "GET");
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 3-6/7");
    expect(await ranged.text()).toBe("ated");
    writeFileSync(join(root, "doc.txt"), "");
    const invalid = await handleWebDavGetHead({ ...ctx("doc.txt"), rangeHeader: "bytes=1-3" }, "HEAD");
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */0");
  });

  it("evaluates weak and strong PUT preconditions against the current physical revision", async () => {
    const put = (headers: Record<string, string>, body: string) =>
      handleWebDavPut(ctx("sync.txt"), new Request(origin, { method: "PUT", body, headers }));
    expect((await put({ "If-Match": "*" }, "old")).status).toBe(412);
    expect((await put({ "If-None-Match": "*" }, "old")).status).toBe(201);
    const tag = (await handleWebDavGetHead(ctx("sync.txt"), "HEAD")).headers.get("etag")!;
    expect(tag).toMatch(/^"[0-9a-f]{64}"$/);
    const properties = await handleWebDavPropFind(ctx("sync.txt"), "0");
    expect(await properties.text()).toContain("<D:getetag>" + tag.replaceAll('"', "&quot;") + "</D:getetag>");
    expect((await put({ "If-None-Match": "W/" + tag }, "bad")).status).toBe(412);
    expect((await put({ "If-Match": "W/" + tag }, "bad")).status).toBe(412);
    const writes = await Promise.all([put({ "If-Match": tag }, "one"), put({ "If-Match": tag }, "two")]);
    expect(writes.map(result => result.status).sort()).toEqual([204, 412]);
    expect(["one", "two"]).toContain(read("sync.txt"));
    expect((await handleWebDavGetHead(ctx("sync.txt"), "HEAD")).headers.get("etag")).not.toBe(tag);
  });

  it("meters staged COPY and requires a complete measured MOVE into a capacity-limited path", async () => {
    const team = await prisma.team.create({ data: { name: prefix, slug: prefix } });
    try {
      await prisma.storageNode.update({ where: { id: prefix }, data: { teamId: team.id } });
      await prisma.userStorageAccess.createMany({ data: ["src", "dst"].map(pathPrefix => ({
        userId: prefix, storageNodeId: prefix, pathPrefix, canRead: true, canWrite: true,
        ...(pathPrefix === "dst" && { maxFileBytes: 4, quotaBytes: 8 }),
      })) });
      const scoped = (file: string) => ({ ...ctx(file), session: { ...session, roles: ["operator" as const], currentTeamId: team.id, permissions: ["storage:read" as const, "storage:write" as const] } });
      await dir("src");
      await dir("dst");
      await file("src/first", "tiny");
      writeFileSync(join(root, "src/first"), "larger bytes");
      expect(await status(handleWebDavCopy(scoped("src/first"), request("COPY", "dst/copy")))).toBe(422);
      expect(readdirSync(join(root, "dst"))).toEqual([]);
      writeFileSync(join(root, "src/first"), "four");
      writeFileSync(join(root, "src/other"), "four");
      const move = () => status(handleWebDavMove(scoped("src"), request("MOVE", "dst/tree")));
      expect(await move()).not.toBe(201);
      expect(existsSync(join(root, "dst/tree"))).toBe(false);
      await file("src/other", "four");
      expect(await move()).toBe(201);
      expect(read("dst/tree/first")).toBe("four");
      expect(read("dst/tree/other")).toBe("four");
    } finally {
      await prisma.team.delete({ where: { id: team.id } });
    }
  });

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

  it.each([["MOVE", handleWebDavMove], ["COPY", handleWebDavCopy]] as const)(
    "%s with Overwrite:F preserves an unindexed destination and its source", async (verb, handler) => {
      const source = await file("a.txt", "source");
      writeFileSync(join(root, "b.txt"), "outside the index");
      expect(await status(handler(ctx("a.txt"), request(verb, "b.txt", "F")))).toBe(412);
      expect(read("a.txt")).toBe("source");
      expect(read("b.txt")).toBe("outside the index");
      const rows = await prisma.fileEntry.findMany({ where: { storageNodeId: prefix } });
      expect(rows.map(row => row.id)).toEqual([source.id]);
    },
  );

  it("PUT preserves an unindexed physical directory and its children", async () => {
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs/keep"), "contents");
    expect(await status(handleWebDavPut(ctx("docs"), new Request(origin, { method: "PUT", body: "new bytes" })))).toBe(409);
    expect(read("docs/keep")).toBe("contents");
    expect(await prisma.fileEntry.count({ where: { storageNodeId: prefix } })).toBe(0);
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

  it("PUT over a recycle-bin file refuses and preserves its bytes and delete batch", async () => {
    const recycled = await file("b.txt", "recycled bytes", true);
    const put = new Request(`${origin}/x`, { method: "PUT", body: "uploaded bytes", headers: { "content-type": "text/plain", "content-length": "14" } });
    expect(await status(handleWebDavPut(ctx("b.txt"), put))).toBe(409);
    expect(read("b.txt")).toBe("recycled bytes");
    const row = await prisma.fileEntry.findUniqueOrThrow({ where: { id: recycled.id } });
    expect(row).toMatchObject({ isDeleted: true, deleteBatchId: recycled.deleteBatchId });
    const versions = await prisma.fileVersion.findMany({ where: { fileEntryId: recycled.id } });
    expect(versions).toHaveLength(0);
  });

  it("an overwrite leaves no checksum of the content it replaced", async () => {
    // A chunked upload records the file's SHA-256 on its entry. PUT, COPY and MOVE over that entry kept the row and
    // the checksum, which then described bytes that were gone.
    const checksumOf = async (id: string) => (await prisma.fileEntry.findUniqueOrThrow({ where: { id } })).checksumSha256;
    const withChecksum = async (relativePath: string, content: string, checksum: string) => {
      const entry = await file(relativePath, content);
      await prisma.fileEntry.update({ where: { id: entry.id }, data: { checksumSha256: checksum } });
      return entry;
    };

    const putTarget = await withChecksum("put.txt", "old", "a".repeat(64));
    const put = new Request(`${origin}/x`, { method: "PUT", body: "uploaded bytes", headers: { "content-type": "text/plain", "content-length": "14" } });
    expect([201, 204]).toContain(await status(handleWebDavPut(ctx("put.txt"), put)));
    expect(await checksumOf(putTarget.id)).toBeNull();

    await file("copy-source.txt", "copied bytes");
    const copyTarget = await withChecksum("copy-target.txt", "old", "b".repeat(64));
    expect(await status(handleWebDavCopy(ctx("copy-source.txt"), request("COPY", "copy-target.txt")))).toBe(204);
    expect(await checksumOf(copyTarget.id)).toBeNull();

    // A move brings its own file: the kept row takes the moved file's checksum, as it takes its size.
    await withChecksum("move-source.txt", "moved bytes", "c".repeat(64));
    const moveTarget = await withChecksum("move-target.txt", "old", "d".repeat(64));
    expect(await status(handleWebDavMove(ctx("move-source.txt"), request("MOVE", "move-target.txt")))).toBe(204);
    expect(await checksumOf(moveTarget.id)).toBe("c".repeat(64));
  });
});
