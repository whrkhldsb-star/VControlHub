/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

/**
 * WebDAV verb handlers. The behaviours pinned here are the ones a client cannot
 * see going wrong until it has already lost data or exceeded a limit:
 *
 *   - a directory listing that is short but returns 207 (see listDirectChildren)
 *   - COPY duplicating bytes without charging them to the destination grant,
 *     which skips BOTH maxFileBytes and quotaBytes inside assertStorageAccess
 *   - a Destination header that points at a different storage node
 */

const mocks = vi.hoisted(() => ({
  assertStorageAccess: vi.fn(),
  releaseStorageQuotaGuard: vi.fn(),
  storageNodeFindFirst: vi.fn(),
  fileEntryFindFirst: vi.fn(),
  fileEntryUpdate: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  streamStorageFile: vi.fn(),
  copyStorageFile: vi.fn(),
  writeStorageFileBuffer: vi.fn(),
  deleteStorageFileBuffer: vi.fn(),
  createFileEntry: vi.fn(),
  createManagedFolder: vi.fn(),
  deleteBackingObject: vi.fn(),
  renameBackingObject: vi.fn(),
  snapshotFileVersionBeforeOverwrite: vi.fn(),
  readRequestBodyBuffer: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    storageNode: { findFirst: mocks.storageNodeFindFirst },
    fileEntry: { findFirst: mocks.fileEntryFindFirst, update: mocks.fileEntryUpdate },
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/auth/team-scope", () => ({ teamWhere: () => ({ teamId: "team_a" }) }));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: mocks.assertStorageAccess,
  releaseStorageQuotaGuard: mocks.releaseStorageQuotaGuard,
}));
vi.mock("@/lib/storage/file-content", async () => {
  const actual = await import("@/lib/storage/file-content");
  return {
    storageFileNodeSelect: actual.storageFileNodeSelect,
    streamStorageFile: mocks.streamStorageFile,
    copyStorageFile: mocks.copyStorageFile,
    writeStorageFileBuffer: mocks.writeStorageFileBuffer,
    deleteStorageFileBuffer: mocks.deleteStorageFileBuffer,
  };
});
vi.mock("@/lib/storage/fs-backend", () => ({
  createManagedFolder: mocks.createManagedFolder,
  deleteBackingObject: mocks.deleteBackingObject,
  renameBackingObject: mocks.renameBackingObject,
}));
vi.mock("@/lib/storage/service-entries", () => ({ createFileEntry: mocks.createFileEntry }));
vi.mock("@/lib/storage/file-versions", () => ({
  snapshotFileVersionBeforeOverwrite: mocks.snapshotFileVersionBeforeOverwrite,
}));
vi.mock("@/lib/http/request-body", async () => {
  const actual = await import("@/lib/http/request-body");
  return {
    readRequestBodyBuffer: mocks.readRequestBodyBuffer,
    RequestBodyTooLargeError: actual.RequestBodyTooLargeError,
  };
});
vi.mock("@/lib/i18n/service-translations", () => ({ t: (key: string) => key }));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const {
  handleWebDavCopy,
  handleWebDavDelete,
  handleWebDavGetHead,
  handleWebDavMove,
  handleWebDavOptions,
  handleWebDavPropFind,
  handleWebDavPut,
} = await import("../handler");

const SESSION = { userId: "u1", username: "alice", roles: ["operator"], currentTeamId: "team_a" };

function context(relativePath: string) {
  return {
    session: SESSION as never,
    storageNodeId: "n1",
    relativePath,
    requestUrl: new URL(`https://hub.example/api/webdav/n1/${relativePath}`),
    rangeHeader: null,
  };
}

function accessCalls() {
  return mocks.assertStorageAccess.mock.calls.map(
    (call) => call[0] as { relativePath: string; operation: string; writeBytes?: number },
  );
}

describe("webdav handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertStorageAccess.mockResolvedValue({ allowed: true });
    mocks.releaseStorageQuotaGuard.mockResolvedValue(undefined);
    mocks.storageNodeFindFirst.mockResolvedValue({
      id: "n1",
      name: "docs",
      driver: "LOCAL",
      basePath: "/srv/docs",
    });
    mocks.queryRaw.mockResolvedValue([]);
    mocks.renameBackingObject.mockResolvedValue(undefined);
    mocks.deleteBackingObject.mockResolvedValue(undefined);
  });

  describe("PROPFIND", () => {
    it("refuses Depth: infinity instead of walking the whole tree", async () => {
      const response = await handleWebDavPropFind(context(""), "infinity");

      expect(response.status).toBe(403);
      expect(mocks.assertStorageAccess).not.toHaveBeenCalled();
    });

    it("lists the node root plus its direct children", async () => {
      mocks.queryRaw.mockResolvedValue([
        {
          id: "d1",
          name: "photos",
          relativePath: "photos",
          entryType: "DIRECTORY",
          size: null,
          mimeType: null,
          updatedAt: new Date("2026-02-01T00:00:00Z"),
        },
        {
          id: "f1",
          name: "notes.txt",
          relativePath: "notes.txt",
          entryType: "FILE",
          size: BigInt(42),
          mimeType: "text/plain",
          updatedAt: new Date("2026-02-02T00:00:00Z"),
        },
      ]);

      const response = await handleWebDavPropFind(context(""), "1");
      const xml = await response.text();

      expect(response.status).toBe(207);
      expect(xml).toContain("<D:href>/api/webdav/n1/</D:href>");
      expect(xml).toContain("<D:href>/api/webdav/n1/photos/</D:href>");
      expect(xml).toContain("<D:href>/api/webdav/n1/notes.txt</D:href>");
      expect(xml).toContain("<D:getcontentlength>42</D:getcontentlength>");
    });

    it("does not query children at all for Depth: 0", async () => {
      const response = await handleWebDavPropFind(context(""), "0");

      expect(response.status).toBe(207);
      expect(mocks.queryRaw).not.toHaveBeenCalled();
    });

    it("answers 507 rather than a silently short listing", async () => {
      // A short 207 is indistinguishable from deletions to a sync client, which
      // is why truncation has to surface as an error.
      mocks.fileEntryFindFirst.mockResolvedValue({
        id: "d1",
        name: "big",
        relativePath: "big",
        entryType: "DIRECTORY",
        size: null,
        updatedAt: new Date(),
      });
      mocks.queryRaw.mockResolvedValue(
        Array.from({ length: 5001 }, (_, index) => ({
          id: `f${index}`,
          name: `f${index}`,
          relativePath: `big/f${index}`,
          entryType: "FILE",
          size: BigInt(1),
          mimeType: null,
          updatedAt: new Date(),
        })),
      );

      const response = await handleWebDavPropFind(context("big"), "1");

      expect(response.status).toBe(507);
      expect(await response.text()).toContain("collectionTooLargeToList");
    });

    it("404s a path with no index row", async () => {
      mocks.fileEntryFindFirst.mockResolvedValue(null);

      await expect(handleWebDavPropFind(context("gone.txt"), "1")).rejects.toThrow(
        "backend.webdav.resourceNotFound",
      );
    });

    it("does not enumerate children of a file", async () => {
      mocks.fileEntryFindFirst.mockResolvedValue({
        id: "f1",
        name: "a.txt",
        relativePath: "a.txt",
        entryType: "FILE",
        size: BigInt(3),
        updatedAt: new Date(),
      });

      await handleWebDavPropFind(context("a.txt"), "1");

      expect(mocks.queryRaw).not.toHaveBeenCalled();
    });
  });

  describe("GET/HEAD", () => {
    it("closes the size probe when the index has no recorded size", async () => {
      const close = vi.fn();
      mocks.fileEntryFindFirst.mockResolvedValue({
        id: "f1",
        name: "a.bin",
        relativePath: "a.bin",
        entryType: "FILE",
        size: null,
        mimeType: null,
        updatedAt: new Date("2026-03-01T00:00:00Z"),
      });
      mocks.streamStorageFile.mockResolvedValue({
        size: 7,
        stream: Readable.from([Buffer.from("abcdefg")]),
        close,
      });

      const response = await handleWebDavGetHead(context("a.bin"), "HEAD");

      expect(response.headers.get("Content-Length")).toBe("7");
      // Probing without closing leaked one fd (LOCAL) or one SSH client (SFTP)
      // per request on any entry with a null size.
      expect(close).toHaveBeenCalled();
    });

    it("serves a satisfiable range as 206 with Content-Range", async () => {
      mocks.fileEntryFindFirst.mockResolvedValue({
        id: "f1",
        name: "a.bin",
        relativePath: "a.bin",
        entryType: "FILE",
        size: BigInt(100),
        mimeType: "application/octet-stream",
        updatedAt: new Date(),
      });

      const response = await handleWebDavGetHead(
        { ...context("a.bin"), rangeHeader: "bytes=10-19" },
        "HEAD",
      );

      expect(response.status).toBe(206);
      expect(response.headers.get("Content-Range")).toBe("bytes 10-19/100");
      expect(response.headers.get("Content-Length")).toBe("10");
    });

    it("checks read access before touching the index", async () => {
      mocks.assertStorageAccess.mockResolvedValue({ allowed: false, reason: "no grant" });

      await expect(handleWebDavGetHead(context("a.bin"), "GET")).rejects.toThrow("no grant");
      expect(mocks.fileEntryFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("PUT", () => {
    it("charges the body size to the write grant and always releases the guard", async () => {
      const guard = { allowed: true, releaseQuotaGuard: vi.fn() };
      mocks.assertStorageAccess.mockResolvedValue(guard);
      mocks.readRequestBodyBuffer.mockResolvedValue(Buffer.alloc(1234));
      mocks.fileEntryFindFirst.mockResolvedValue(null);
      mocks.createFileEntry.mockResolvedValue({ id: "f_new" });

      const response = await handleWebDavPut(
        context("dir/a.bin"),
        new Request("https://hub.example/api/webdav/n1/dir/a.bin", { method: "PUT" }),
      );

      expect(response.status).toBe(201);
      expect(accessCalls()[0]).toMatchObject({
        relativePath: "dir/a.bin",
        operation: "write",
        writeBytes: 1234,
      });
      expect(mocks.releaseStorageQuotaGuard).toHaveBeenCalledWith(guard);
    });

    it("releases the guard even when the write fails", async () => {
      const guard = { allowed: true, releaseQuotaGuard: vi.fn() };
      mocks.assertStorageAccess.mockResolvedValue(guard);
      mocks.readRequestBodyBuffer.mockResolvedValue(Buffer.alloc(4));
      mocks.fileEntryFindFirst.mockResolvedValue(null);
      mocks.writeStorageFileBuffer.mockRejectedValue(new Error("disk full"));

      await expect(
        handleWebDavPut(
          context("a.bin"),
          new Request("https://hub.example/api/webdav/n1/a.bin", { method: "PUT" }),
        ),
      ).rejects.toThrow("disk full");
      expect(mocks.releaseStorageQuotaGuard).toHaveBeenCalledWith(guard);
    });

    it("answers 413 for an oversized body without consuming a grant", async () => {
      const { RequestBodyTooLargeError } = await import("@/lib/http/request-body");
      mocks.readRequestBodyBuffer.mockRejectedValue(new RequestBodyTooLargeError(1));

      const response = await handleWebDavPut(
        context("a.bin"),
        new Request("https://hub.example/api/webdav/n1/a.bin", { method: "PUT" }),
      );

      expect(response.status).toBe(413);
      expect(mocks.assertStorageAccess).not.toHaveBeenCalled();
    });

    it("refuses to replace a collection with a file", async () => {
      mocks.readRequestBodyBuffer.mockResolvedValue(Buffer.alloc(4));
      mocks.fileEntryFindFirst.mockResolvedValue({ id: "d1", entryType: "DIRECTORY" });

      await expect(
        handleWebDavPut(
          context("dir"),
          new Request("https://hub.example/api/webdav/n1/dir", { method: "PUT" }),
        ),
      ).rejects.toThrow("backend.webdav.cannotOverwriteACollectionWithAFile");
      expect(mocks.writeStorageFileBuffer).not.toHaveBeenCalled();
    });

    it("refuses a PUT at the collection root", async () => {
      await expect(
        handleWebDavPut(
          context(""),
          new Request("https://hub.example/api/webdav/n1", { method: "PUT" }),
        ),
      ).rejects.toThrow("backend.webdav.cannotPutToCollectionRoot");
    });
  });

  describe("DELETE", () => {
    it("asks for delete access, not write access", async () => {
      mocks.fileEntryFindFirst.mockResolvedValue({
        id: "f1",
        entryType: "FILE",
        relativePath: "a.txt",
      });
      mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
        fn({ fileEntry: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() } }),
      );

      const response = await handleWebDavDelete(context("a.txt"));

      expect(response.status).toBe(204);
      expect(accessCalls()[0]?.operation).toBe("delete");
    });

    it("restores the staged bytes when the index transaction fails", async () => {
      mocks.fileEntryFindFirst.mockResolvedValue({
        id: "f1",
        entryType: "FILE",
        relativePath: "a.txt",
      });
      mocks.transaction.mockRejectedValue(new Error("deadlock"));

      await expect(handleWebDavDelete(context("a.txt"))).rejects.toThrow("deadlock");

      // Staged away first, then renamed back — never left as an unindexed orphan.
      const renames = mocks.renameBackingObject.mock.calls.map(
        (call) => call[0] as { oldRelativePath: string; newRelativePath: string },
      );
      expect(renames[0]?.oldRelativePath).toBe("a.txt");
      expect(renames[1]?.newRelativePath).toBe("a.txt");
      expect(mocks.deleteBackingObject).not.toHaveBeenCalled();
    });

    it("refuses to delete the collection root", async () => {
      await expect(handleWebDavDelete(context(""))).rejects.toThrow(
        "backend.webdav.cannotDeleteCollectionRoot",
      );
    });
  });

  describe("Destination header", () => {
    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      vi.stubEnv("APP_BASE_URL", "https://public.example");
    });
    afterEach(() => vi.unstubAllEnvs());

    function moveWith(destination: string) {
      return handleWebDavMove(
        context("a.txt"),
        new Request("https://hub.example/api/webdav/n1/a.txt", {
          method: "POST",
          headers: { destination },
        }),
      );
    }

    it("refuses a cross-origin destination", async () => {
      await expect(moveWith("https://evil.example/api/webdav/n1/b.txt")).rejects.toThrow(
        "backend.webdav.destinationMustStayOnTheSameOrigin",
      );
    });

    it("refuses a node id that merely shares a prefix", async () => {
      // "/api/webdav/n1-evil/..." must not satisfy a request scoped to node "n1".
      await expect(moveWith("/api/webdav/n1-evil/b.txt")).rejects.toThrow(
        "backend.webdav.destinationMustStayOnTheSameStorageNode",
      );
    });

    it("refuses a destination on another storage node", async () => {
      await expect(moveWith("/api/webdav/n2/b.txt")).rejects.toThrow(
        "backend.webdav.destinationMustStayOnTheSameStorageNode",
      );
    });

    it("keeps node boundaries on the configured public origin", async () => {
      await expect(moveWith("https://public.example/api/webdav/n2/b.txt")).rejects.toThrow(
        "backend.webdav.destinationMustStayOnTheSameStorageNode",
      );
    });

    it("does not trust a malformed configured public origin", async () => {
      vi.stubEnv("APP_BASE_URL", "not a URL");
      await expect(moveWith("https://evil.example/api/webdav/n1/b.txt")).rejects.toThrow(
        "backend.webdav.destinationMustStayOnTheSameOrigin",
      );
    });

    it("requires the header at all", async () => {
      await expect(
        handleWebDavMove(
          context("a.txt"),
          new Request("https://hub.example/api/webdav/n1/a.txt", { method: "POST" }),
        ),
      ).rejects.toThrow("backend.webdav.destinationHeaderRequired");
    });

    it.each(["/api/webdav/n1/moved/b.txt", "https://public.example/api/webdav/n1/moved/b.txt"])("accepts a same-node destination with both access checks: %s", async (destination) => {
      mocks.fileEntryFindFirst.mockImplementation(async (args: { where: { relativePath: string } }) =>
        args.where.relativePath === "a.txt"
          ? { id: "f1", entryType: "FILE", relativePath: "a.txt" }
          : null,
      );
      mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
        fn({ fileEntry: { update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) } }),
      );

      const response = await moveWith(destination);

      expect(response.status).toBe(201);
      expect(accessCalls().map((call) => `${call.operation}:${call.relativePath}`)).toEqual([
        "write:a.txt",
        "write:moved/b.txt",
      ]);
    });
  });

  describe("COPY", () => {
    beforeEach(() => {
      mocks.fileEntryFindFirst.mockImplementation(async (args: { where: { relativePath: string } }) =>
        args.where.relativePath === "a.bin"
          ? { id: "f1", entryType: "FILE", relativePath: "a.bin", mimeType: "application/pdf", size: BigInt(900) }
          : null,
      );
      mocks.copyStorageFile.mockResolvedValue({ size: 900 });
      mocks.createFileEntry.mockResolvedValue({ id: "f_copy" });
    });

    function copyWith(destination: string) {
      return handleWebDavCopy(
        context("a.bin"),
        new Request("https://hub.example/api/webdav/n1/a.bin", {
          method: "POST",
          headers: { destination },
        }),
      );
    }

    it("charges the copied bytes to the destination grant", async () => {
      const response = await copyWith("/api/webdav/n1/b.bin");

      expect(response.status).toBe(201);
      // Without writeBytes, assertStorageAccess evaluates neither maxFileBytes
      // nor quotaBytes, so COPY could duplicate past its own capacity limit.
      expect(accessCalls()).toEqual([
        expect.objectContaining({ relativePath: "a.bin", operation: "read" }),
        expect.objectContaining({ relativePath: "b.bin", operation: "write", writeBytes: 900 }),
      ]);
    });

    it("probes the backend for a size the index does not have", async () => {
      const close = vi.fn();
      mocks.fileEntryFindFirst.mockImplementation(async (args: { where: { relativePath: string } }) =>
        args.where.relativePath === "a.bin"
          ? { id: "f1", entryType: "FILE", relativePath: "a.bin", mimeType: null, size: null }
          : null,
      );
      mocks.streamStorageFile.mockResolvedValue({
        size: 512,
        stream: Readable.from([]),
        close,
      });

      await copyWith("/api/webdav/n1/b.bin");

      expect(accessCalls()[1]).toMatchObject({ operation: "write", writeBytes: 512 });
      expect(close).toHaveBeenCalled();
    });

    it("releases the quota guard once the index is written", async () => {
      const guard = { allowed: true, releaseQuotaGuard: vi.fn() };
      mocks.assertStorageAccess.mockResolvedValue(guard);

      await copyWith("/api/webdav/n1/b.bin");

      expect(mocks.releaseStorageQuotaGuard).toHaveBeenCalledWith(guard);
    });

    it("releases the quota guard when the copy fails", async () => {
      const guard = { allowed: true, releaseQuotaGuard: vi.fn() };
      mocks.assertStorageAccess.mockResolvedValue(guard);
      mocks.copyStorageFile.mockRejectedValue(new Error("backend refused"));

      await expect(copyWith("/api/webdav/n1/b.bin")).rejects.toThrow("backend refused");
      expect(mocks.releaseStorageQuotaGuard).toHaveBeenCalledWith(guard);
    });

    it("rejects a collection source before checking write access", async () => {
      mocks.fileEntryFindFirst.mockResolvedValue({
        id: "d1",
        entryType: "DIRECTORY",
        relativePath: "a.bin",
        mimeType: null,
        size: null,
      });

      await expect(copyWith("/api/webdav/n1/b.bin")).rejects.toThrow(
        "backend.webdav.copyOfCollectionsIsNotSupportedCopyFiles",
      );
      expect(accessCalls().some((call) => call.operation === "write")).toBe(false);
    });

    it("honours Overwrite: F on an existing destination", async () => {
      mocks.fileEntryFindFirst.mockImplementation(async (args: { where: { relativePath: string } }) =>
        args.where.relativePath === "a.bin"
          ? { id: "f1", entryType: "FILE", relativePath: "a.bin", mimeType: null, size: BigInt(10) }
          : { id: "f2", entryType: "FILE", relativePath: "b.bin", mimeType: null, size: BigInt(5) },
      );

      await expect(
        handleWebDavCopy(
          context("a.bin"),
          new Request("https://hub.example/api/webdav/n1/a.bin", {
            method: "POST",
            headers: { destination: "/api/webdav/n1/b.bin", overwrite: "F" },
          }),
        ),
      ).rejects.toThrow("backend.webdav.destinationExistsAndOverwriteIsF");
      expect(mocks.copyStorageFile).not.toHaveBeenCalled();
    });
  });

  describe("OPTIONS", () => {
    it("advertises DAV compliance classes and the verbs the route dispatches", async () => {
      const response = await handleWebDavOptions();

      expect(response.status).toBe(204);
      expect(response.headers.get("DAV")).toBe("1");
      for (const verb of ["PROPFIND", "PUT", "DELETE", "MKCOL", "MOVE", "COPY"]) {
        expect(response.headers.get("Allow")).toContain(verb);
      }
    });
  });

  describe("GET body", () => {
    it("streams the stored bytes back with a 200", async () => {
      mocks.fileEntryFindFirst.mockResolvedValue({
        id: "f1",
        name: "a.txt",
        relativePath: "a.txt",
        entryType: "FILE",
        size: BigInt(5),
        mimeType: "text/plain",
        updatedAt: new Date("2026-04-01T00:00:00Z"),
      });
      mocks.streamStorageFile.mockResolvedValue({
        size: 5,
        stream: Readable.from([Buffer.from("hello")]),
        close: vi.fn(),
      });

      const response = await handleWebDavGetHead(context("a.txt"), "GET");

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("hello");
      expect(response.headers.get("ETag")).toMatch(/^W\//);
    });

    it("reports an empty GET body as zero bytes", async () => {
      mocks.fileEntryFindFirst.mockResolvedValue({ id: "empty", name: "empty.txt", relativePath: "empty.txt", entryType: "FILE", size: BigInt(0), updatedAt: new Date() });
      mocks.streamStorageFile.mockResolvedValue({ size: 0, stream: Readable.from([]), close: vi.fn() });
      const response = await handleWebDavGetHead(context("empty.txt"), "GET");
      expect(response.headers.get("Content-Length")).toBe("0");
      expect(await response.text()).toBe("");
    });

    it("sends no body for HEAD even though it reports the length", async () => {
      mocks.fileEntryFindFirst.mockResolvedValue({
        id: "f1",
        name: "a.txt",
        relativePath: "a.txt",
        entryType: "FILE",
        size: BigInt(5),
        mimeType: "text/plain",
        updatedAt: new Date(),
      });

      const response = await handleWebDavGetHead(context("a.txt"), "HEAD");

      expect(response.headers.get("Content-Length")).toBe("5");
      expect(await response.text()).toBe("");
      // No stream should have been opened at all for a HEAD with a known size.
      expect(mocks.streamStorageFile).not.toHaveBeenCalled();
    });
  });

  describe("PUT declared length", () => {
    it("rejects an oversized Content-Length before reading or authorizing", async () => {
      // Exercises the real requestContentLengthExceeds path rather than a mocked
      // rejection, because that check is what stops a 10 GB upload from being
      // buffered in memory at all.
      const actual = await vi.importActual<typeof import("@/lib/http/request-body")>(
        "@/lib/http/request-body",
      );
      mocks.readRequestBodyBuffer.mockImplementation(actual.readRequestBodyBuffer);

      const response = await handleWebDavPut(
        context("a.bin"),
        new Request("https://hub.example/api/webdav/n1/a.bin", {
          method: "PUT",
          body: "x",
          headers: { "content-length": String(100 * 1024 * 1024 + 1) },
        }),
      );

      expect(response.status).toBe(413);
      expect(mocks.writeStorageFileBuffer).not.toHaveBeenCalled();
      expect(mocks.assertStorageAccess).not.toHaveBeenCalled();
    });
  });

  describe("COPY over an existing destination", () => {
    it("updates the destination entry instead of colliding on a new one", async () => {
      mocks.fileEntryFindFirst.mockImplementation(async (args: { where: { relativePath: string } }) =>
        args.where.relativePath === "src.txt"
          ? {
              id: "src1",
              name: "src.txt",
              relativePath: "src.txt",
              entryType: "FILE",
              size: BigInt(5),
              mimeType: "text/plain",
              updatedAt: new Date(),
            }
          : {
              id: "dst1",
              name: "dst.txt",
              relativePath: "dst.txt",
              entryType: "FILE",
              size: BigInt(1),
              mimeType: "text/plain",
              updatedAt: new Date(),
            },
      );
      mocks.copyStorageFile.mockResolvedValue({ size: 5 });
      mocks.fileEntryUpdate.mockResolvedValue({ id: "dst1" });
      mocks.snapshotFileVersionBeforeOverwrite.mockResolvedValue(undefined);

      const response = await handleWebDavCopy(
        context("src.txt"),
        new Request("https://hub.example/api/webdav/n1/src.txt", {
          method: "POST",
          headers: { destination: "/api/webdav/n1/dst.txt", overwrite: "T" },
        }),
      );

      expect(response.status).toBe(204);
      expect(mocks.copyStorageFile).toHaveBeenCalledWith(expect.anything(), "src.txt", "dst.txt");
      // A second FileEntry on the same relativePath would violate the unique index.
      expect(mocks.createFileEntry).not.toHaveBeenCalled();
      expect(mocks.fileEntryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "dst1" },
          data: expect.objectContaining({
            size: BigInt(5),
            entryType: "FILE",
            isDeleted: false,
          }),
        }),
      );
      // The bytes being replaced have to be recoverable.
      expect(mocks.snapshotFileVersionBeforeOverwrite).toHaveBeenCalled();
    });
  });

  describe("MOVE rollback", () => {
    it("renames the object back when the index transaction fails", async () => {
      mocks.fileEntryFindFirst.mockImplementation(async (args: { where: { relativePath: string } }) =>
        args.where.relativePath === "src.txt"
          ? { id: "src1", entryType: "FILE", relativePath: "src.txt" }
          : null,
      );
      mocks.transaction.mockRejectedValue(new Error("index unavailable"));

      await expect(
        handleWebDavMove(
          context("src.txt"),
          new Request("https://hub.example/api/webdav/n1/src.txt", {
            method: "POST",
            headers: { destination: "/api/webdav/n1/dst.txt" },
          }),
        ),
      ).rejects.toThrow("index unavailable");

      // Without the compensating rename the file would exist at dst.txt while the
      // index still pointed at src.txt — invisible to every later request.
      expect(mocks.renameBackingObject).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ oldRelativePath: "src.txt", newRelativePath: "dst.txt" }),
      );
      expect(mocks.renameBackingObject).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ oldRelativePath: "dst.txt", newRelativePath: "src.txt" }),
      );
    });
  });
});
