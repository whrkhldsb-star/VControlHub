import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  prismaMock,
  assertAccessMock,
  readBufferMock,
  writeBufferMock,
  createFolderMock,
  deleteBackingMock,
  renameBackingMock,
  createEntryMock,
  softDeleteMock,
  snapshotMock,
} = vi.hoisted(() => ({
  prismaMock: {
    storageNode: { findUnique: vi.fn() },
    fileEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
  assertAccessMock: vi.fn(),
  readBufferMock: vi.fn(),
  writeBufferMock: vi.fn(),
  createFolderMock: vi.fn(),
  deleteBackingMock: vi.fn(),
  renameBackingMock: vi.fn(),
  createEntryMock: vi.fn(),
  softDeleteMock: vi.fn(),
  snapshotMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: assertAccessMock }));
vi.mock("@/lib/storage/file-content", () => ({
  readStorageFileBuffer: readBufferMock,
  writeStorageFileBuffer: writeBufferMock,
  storageFileNodeSelect: {},
}));
vi.mock("@/lib/storage/fs-backend", () => ({
  createManagedFolder: createFolderMock,
  deleteBackingObject: deleteBackingMock,
  renameBackingObject: renameBackingMock,
}));
vi.mock("@/lib/storage/service-entries", () => ({
  createFileEntry: createEntryMock,
  softDeleteFileEntry: softDeleteMock,
}));
vi.mock("@/lib/storage/file-versions", () => ({
  snapshotFileVersionBeforeOverwrite: snapshotMock,
}));
vi.mock("@/lib/http/mime-types", () => ({
  guessContentType: () => "text/plain",
}));

import {
  buildWebDavHref,
  handleWebDavGetHead,
  handleWebDavOptions,
  handleWebDavPropFind,
  handleWebDavPut,
  normalizeWebDavRelativePath,
} from "../handler";
import { buildPropFindMultistatus, parseDepth } from "../xml";
import { webDavScopeForMethod } from "../auth";

const session = {
  userId: "u1",
  username: "admin",
  roles: ["admin"] as const,
  mustChangePassword: false,
  currentTeamId: null,
};

describe("webdav helpers", () => {
  it("normalizes paths and builds hrefs", () => {
    expect(normalizeWebDavRelativePath(["docs", "a.txt"])).toBe("docs/a.txt");
    expect(normalizeWebDavRelativePath(undefined)).toBe("");
    expect(buildWebDavHref("node1", "docs/a.txt", false)).toBe(
      "/api/webdav/node1/docs/a.txt",
    );
    expect(buildWebDavHref("node1", "docs", true)).toBe("/api/webdav/node1/docs/");
  });

  it("parses depth and builds multistatus xml", () => {
    expect(parseDepth("0")).toBe(0);
    expect(parseDepth(null)).toBe(1);
    const xml = buildPropFindMultistatus([
      {
        href: "/api/webdav/n/",
        displayName: "root",
        isCollection: true,
      },
    ]);
    expect(xml).toContain("multistatus");
    expect(xml).toContain("<D:collection/>");
  });

  it("maps methods to scopes", () => {
    expect(webDavScopeForMethod("PROPFIND")).toBe("read");
    expect(webDavScopeForMethod("PUT")).toBe("write");
    expect(webDavScopeForMethod("DELETE")).toBe("delete");
  });
});

describe("webdav handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAccessMock.mockResolvedValue({ allowed: true });
    prismaMock.storageNode.findUnique.mockResolvedValue({
      id: "node1",
      name: "Local",
      driver: "LOCAL",
      basePath: "/data",
    });
  });

  it("OPTIONS returns DAV allow headers", async () => {
    const res = await handleWebDavOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get("DAV")).toContain("1");
    expect(res.headers.get("Allow")).toContain("PROPFIND");
  });

  it("PROPFIND root lists children", async () => {
    prismaMock.fileEntry.findMany.mockResolvedValue([
      {
        id: "f1",
        name: "readme.txt",
        relativePath: "readme.txt",
        entryType: "FILE",
        size: BigInt(3),
        mimeType: "text/plain",
        updatedAt: new Date("2026-07-15T00:00:00Z"),
      },
    ]);
    const res = await handleWebDavPropFind(
      {
        session: session as never,
        storageNodeId: "node1",
        relativePath: "",
        requestUrl: new URL("http://localhost/api/webdav/node1/"),
      },
      "1",
    );
    expect(res.status).toBe(207);
    const text = await res.text();
    expect(text).toContain("readme.txt");
  });

  it("GET returns file bytes", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValue({
      id: "f1",
      name: "a.txt",
      relativePath: "a.txt",
      entryType: "FILE",
      size: BigInt(5),
      mimeType: "text/plain",
      updatedAt: new Date(),
    });
    readBufferMock.mockResolvedValue(Buffer.from("hello"));
    const res = await handleWebDavGetHead(
      {
        session: session as never,
        storageNodeId: "node1",
        relativePath: "a.txt",
        requestUrl: new URL("http://localhost/api/webdav/node1/a.txt"),
      },
      "GET",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("PUT writes new file and indexes", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValue(null);
    writeBufferMock.mockResolvedValue("/data/a.txt");
    createEntryMock.mockResolvedValue({ id: "new1" });
    const req = new Request("http://localhost/api/webdav/node1/a.txt", {
      method: "PUT",
      body: "hello",
      headers: { "content-type": "text/plain" },
    });
    const res = await handleWebDavPut(
      {
        session: session as never,
        storageNodeId: "node1",
        relativePath: "a.txt",
        requestUrl: new URL("http://localhost/api/webdav/node1/a.txt"),
      },
      req,
    );
    expect(res.status).toBe(201);
    expect(writeBufferMock).toHaveBeenCalled();
    expect(createEntryMock).toHaveBeenCalled();
  });
});
