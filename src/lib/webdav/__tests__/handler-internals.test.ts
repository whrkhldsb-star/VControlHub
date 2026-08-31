/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";

/**
 * Path handling and child enumeration for WebDAV.
 *
 * Two things here are load-bearing:
 *   - the URL path must be percent-decoded PER SEGMENT before validation, so an
 *     encoded separator or traversal cannot smuggle itself past the storage path
 *     validator that runs afterwards
 *   - a directory listing must apply its depth test in the database; a prefix
 *     query matches the whole subtree, so filtering afterwards in JS silently
 *     truncates the listing of any directory with a large subtree
 */

const mocks = vi.hoisted(() => ({
  storageNodeFindFirst: vi.fn(),
  storageNodeFindUnique: vi.fn(),
  fileEntryFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  teamWhere: vi.fn(),
  assertStorageAccess: vi.fn(),
  createManagedFolder: vi.fn(),
  deleteBackingObject: vi.fn(),
  createFileEntry: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    storageNode: {
      findFirst: mocks.storageNodeFindFirst,
      findUnique: mocks.storageNodeFindUnique,
    },
    fileEntry: { findFirst: mocks.fileEntryFindFirst },
    $queryRaw: mocks.queryRaw,
  },
}));
vi.mock("@/lib/auth/team-scope", () => ({ teamWhere: mocks.teamWhere }));
vi.mock("@/lib/i18n/service-translations", () => ({
  t: (key: string) => key,
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: mocks.assertStorageAccess,
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));
vi.mock("@/lib/storage/fs-backend", () => ({
  createManagedFolder: mocks.createManagedFolder,
  deleteBackingObject: mocks.deleteBackingObject,
}));
vi.mock("@/lib/storage/service-entries", () => ({ createFileEntry: mocks.createFileEntry }));

const {
  MAX_PROPFIND_CHILDREN,
  buildWebDavHref,
  ensureDirectoryIndexAndBacking,
  entryName,
  listDirectChildren,
  loadNode,
  normalizeWebDavRelativePath,
  parentRelativePath,
  weakEtag,
} = await import("../handler-internals");

const session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> = {
  userId: "u1",
  roles: ["operator"],
  currentTeamId: "team_a",
};


describe("normalizeWebDavRelativePath", () => {
  it("joins route segments and decodes each one on its own", () => {
    expect(normalizeWebDavRelativePath(["dir", "a%20b.txt"])).toBe("dir/a b.txt");
  });

  it("rejects an encoded separator instead of turning it into a path boundary", () => {
    // %2F decoded before the split would create a segment boundary the storage
    // validator never sees; decoding per segment keeps it a literal character,
    // which the segment validator then rejects.
    expect(() => normalizeWebDavRelativePath(["a%2F..%2Fetc"])).toThrow();
  });

  it("rejects traversal in plain and encoded form", () => {
    expect(() => normalizeWebDavRelativePath(["..", "etc", "passwd"])).toThrow();
    expect(() => normalizeWebDavRelativePath(["%2E%2E", "etc"])).toThrow();
    expect(() => normalizeWebDavRelativePath(["a", "..", "b"])).toThrow();
  });

  it("treats the collection root as an empty path", () => {
    expect(normalizeWebDavRelativePath(undefined)).toBe("");
    expect(normalizeWebDavRelativePath([])).toBe("");
    expect(normalizeWebDavRelativePath("/")).toBe("");
  });

  it("keeps a malformed escape as a literal instead of throwing on decode", () => {
    // decodeURIComponent("%E0%A4%A") throws; the segment must fall back to raw.
    expect(() => normalizeWebDavRelativePath(["%zz"])).not.toThrow();
  });
});

describe("buildWebDavHref", () => {
  it("percent-encodes each segment and marks collections with a trailing slash", () => {
    expect(buildWebDavHref("node 1", "a b/c#d.txt", false)).toBe(
      "/api/webdav/node%201/a%20b/c%23d.txt",
    );
    expect(buildWebDavHref("n1", "dir", true)).toBe("/api/webdav/n1/dir/");
    expect(buildWebDavHref("n1", "", true)).toBe("/api/webdav/n1/");
  });
});

describe("parentRelativePath / entryName", () => {
  it("splits on the last separator and returns empty at the root", () => {
    expect(parentRelativePath("a/b/c.txt")).toBe("a/b");
    expect(parentRelativePath("c.txt")).toBe("");
    expect(parentRelativePath("")).toBe("");
    expect(entryName("a/b/c.txt")).toBe("c.txt");
    expect(entryName("c.txt")).toBe("c.txt");
    expect(entryName("")).toBe("");
  });
});

describe("weakEtag", () => {
  it("changes when size or mtime changes so clients revalidate after an overwrite", () => {
    const base = { id: "f1", size: BigInt(10), updatedAt: new Date("2026-01-01T00:00:00Z") };
    const resized = { ...base, size: BigInt(11) };
    const touched = { ...base, updatedAt: new Date("2026-01-02T00:00:00Z") };

    expect(weakEtag(base)).toMatch(/^W\/"[0-9a-f]{16}"$/);
    expect(weakEtag(resized)).not.toBe(weakEtag(base));
    expect(weakEtag(touched)).not.toBe(weakEtag(base));
  });

  it("returns null when there is nothing to fingerprint", () => {
    expect(weakEtag({})).toBeNull();
  });
});

describe("loadNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.teamWhere.mockReturnValue({ teamId: "team_a" });
  });

  it("scopes the lookup with teamWhere so another team's node is invisible", async () => {
    mocks.storageNodeFindFirst.mockResolvedValue({ id: "n1", driver: "LOCAL", name: "docs" });

    await loadNode("n1", session);

    expect(mocks.teamWhere).toHaveBeenCalledWith(session);
    expect(mocks.storageNodeFindFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      id: "n1",
      teamId: "team_a",
    });
    // findUnique takes only the primary key, so it cannot carry the team filter —
    // reaching for it here would silently expose another tenant's node.
    expect(mocks.storageNodeFindUnique).not.toHaveBeenCalled();
  });

  it("refuses a driver that has no WebDAV backend", async () => {
    mocks.storageNodeFindFirst.mockResolvedValue({ id: "n1", driver: "S3", name: "bucket" });

    await expect(loadNode("n1", session)).rejects.toThrow(
      "backend.webdav.storageNodeNotFoundOrNotWebdavCapable",
    );
  });

  it("reports a node outside the caller's team as not found, not as forbidden", async () => {
    mocks.storageNodeFindFirst.mockResolvedValue(null);

    await expect(loadNode("n1", session)).rejects.toThrow(
      "backend.webdav.storageNodeNotFoundOrNotWebdavCapable",
    );
  });
});

describe("listDirectChildren", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([]);
  });

  /** The interpolated values of the tagged-template query, in order. */
  function boundValues(): unknown[] {
    return mocks.queryRaw.mock.calls[0]?.slice(1) ?? [];
  }

  function sql(): string {
    return (mocks.queryRaw.mock.calls[0]?.[0] as string[]).join("?");
  }

  it("applies the depth test in SQL rather than after the fact", async () => {
    await listDirectChildren("n1", "docs/2026");

    // position('/' in substring(path from len+1)) = 0 is what makes the result
    // exactly the direct children; without it the prefix matches the whole tree.
    expect(sql()).toContain("position('/' in substring");
    expect(sql()).toContain('"isDeleted" = false');
    // "docs/2026/" is 10 chars: the row must be longer than that and carry no
    // separator from position 11 onwards.
    expect(boundValues()).toEqual(["n1", "docs/2026/%", 10, 11, MAX_PROPFIND_CHILDREN + 1]);
  });

  it("lists the node root with an empty prefix", async () => {
    await listDirectChildren("n1", "");

    expect(boundValues()).toEqual(["n1", "%", 0, 1, MAX_PROPFIND_CHILDREN + 1]);
  });

  it("escapes LIKE metacharacters in the directory name", async () => {
    // A directory literally called "100%_raw" must not become a wildcard that
    // lists siblings.
    await listDirectChildren("n1", "100%_raw");

    expect(boundValues()[1]).toBe("100\\%\\_raw/%");
    expect(sql()).toContain("ESCAPE");
  });

  it("reports truncation instead of returning a quietly short list", async () => {
    const rows = Array.from({ length: 4 }, (_, index) => ({ id: `f${index}` }));
    mocks.queryRaw.mockResolvedValue(rows);

    const result = await listDirectChildren("n1", "big", 3);

    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(3);
  });

  it("does not flag truncation when the page is exactly full", async () => {
    mocks.queryRaw.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);

    const result = await listDirectChildren("n1", "big", 3);

    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(3);
  });
});

describe("ensureDirectoryIndexAndBacking", () => {
  const SFTP_NODE = {
    id: "n1",
    driver: "SFTP" as const,
    basePath: "/data",
    host: "sftp.example.com",
    port: 22,
    username: "root",
    serverId: null,
    server: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertStorageAccess.mockResolvedValue({ allowed: true });
    mocks.createManagedFolder.mockResolvedValue(undefined);
    mocks.deleteBackingObject.mockResolvedValue(undefined);
    mocks.createFileEntry.mockResolvedValue({ id: "d_new" });
  });

  it("does nothing at the node root", async () => {
    await ensureDirectoryIndexAndBacking({
      session: session as never,
      node: SFTP_NODE,
      storageNodeId: "n1",
      relativePath: "",
    });

    expect(mocks.createManagedFolder).not.toHaveBeenCalled();
  });

  it("removes the backing directory it just created when indexing fails", async () => {
    // Otherwise MKCOL leaves an unindexed directory on the backend that no
    // subsequent request can see, let alone clean up.
    mocks.fileEntryFindFirst.mockResolvedValue(null);
    mocks.createFileEntry.mockRejectedValue(new Error("index unavailable"));

    await expect(
      ensureDirectoryIndexAndBacking({
        session: session as never,
        node: SFTP_NODE,
        storageNodeId: "n1",
        relativePath: "new-folder",
      }),
    ).rejects.toThrow("index unavailable");
    expect(mocks.deleteBackingObject).toHaveBeenCalledWith({
      storageNode: expect.objectContaining({ id: "n1" }),
      relativePath: "new-folder",
      isDirectory: true,
      tolerateMissing: true,
    });
  });

  it("creates each missing ancestor in order", async () => {
    mocks.fileEntryFindFirst.mockResolvedValue(null);

    await ensureDirectoryIndexAndBacking({
      session: session as never,
      node: SFTP_NODE,
      storageNodeId: "n1",
      relativePath: "a/b/c",
    });

    expect(
      mocks.createManagedFolder.mock.calls.map(
        (call) => (call[0] as { relativePath: string }).relativePath,
      ),
    ).toEqual(["a", "a/b", "a/b/c"]);
  });

  it("skips ancestors that already exist as directories", async () => {
    mocks.fileEntryFindFirst.mockImplementation(async (args: { where: { relativePath: string } }) =>
      args.where.relativePath === "a" ? { id: "d1", entryType: "DIRECTORY" } : null,
    );

    await ensureDirectoryIndexAndBacking({
      session: session as never,
      node: SFTP_NODE,
      storageNodeId: "n1",
      relativePath: "a/b",
    });

    expect(
      mocks.createManagedFolder.mock.calls.map(
        (call) => (call[0] as { relativePath: string }).relativePath,
      ),
    ).toEqual(["a/b"]);
  });

  it("refuses to tunnel a directory through an existing file", async () => {
    mocks.fileEntryFindFirst.mockResolvedValue({ id: "f1", entryType: "FILE" });

    await expect(
      ensureDirectoryIndexAndBacking({
        session: session as never,
        node: SFTP_NODE,
        storageNodeId: "n1",
        relativePath: "a.txt/b",
      }),
    ).rejects.toThrow("backend.webdav.pathComponentIsAFile");
    expect(mocks.createManagedFolder).not.toHaveBeenCalled();
  });

  it("checks write access on every level it creates", async () => {
    mocks.fileEntryFindFirst.mockResolvedValue(null);

    await ensureDirectoryIndexAndBacking({
      session: session as never,
      node: SFTP_NODE,
      storageNodeId: "n1",
      relativePath: "a/b",
    });

    expect(
      mocks.assertStorageAccess.mock.calls.map(
        (call) => (call[0] as { relativePath: string; operation: string }),
      ),
    ).toEqual([
      expect.objectContaining({ relativePath: "a", operation: "write" }),
      expect.objectContaining({ relativePath: "a/b", operation: "write" }),
    ]);
  });
});
