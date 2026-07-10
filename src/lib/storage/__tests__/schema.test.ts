import { describe, expect, it } from "vitest";

import {
  contentDownloadQuerySchema,
  createFileEntrySchema,
  createStorageNodeSchema,
  directAccessDownloadQuerySchema,
  directAccessInputSchema,
  sftpListQuerySchema,
  sftpOpsActionSchema,
  sftpOpsBodySchema,
  sftpStaleInventoryBodySchema,
  sftpSyncBodySchema,
  sftpWaitQuerySchema,
  storageFileQuerySchema,
} from "@/lib/storage/schema";

describe("storage schema", () => {
  it("accepts a local storage node", () => {
    const result = createStorageNodeSchema.parse({
      name: "主控本机",
      driver: "LOCAL",
      basePath: "/srv/whrkhldsb/storage",
      isDefault: true,
    });

    expect(result.driver).toBe("LOCAL");
    expect(result.basePath).toBe("/srv/whrkhldsb/storage");
  });

  it("accepts file metadata", () => {
    const result = createFileEntrySchema.parse({
      storageNodeId: "node_1",
      name: "demo.mp4",
      entryType: "FILE",
      mimeType: "video/mp4",
      size: 1024,
      relativePath: "videos/demo.mp4",
    });

    expect(result.entryType).toBe("FILE");
    expect(result.size).toBe(1024);
  });

  it("rejects invalid port ranges", () => {
    expect(() =>
      createStorageNodeSchema.parse({
        name: "远端库",
        driver: "SFTP",
        basePath: "/data/media",
        port: 70000,
      }),
    ).toThrow(/at most 65535/i);
  });

  it("rejects private or credentialed direct-access base URLs before persistence", () => {
    for (const publicBaseUrl of [
      "http://127.0.0.1:31888/files",
      "http://localhost:31888/files",
      "http://10.0.0.5:31888/files",
      "http://[::1]:31888/files",
      "https://user:pass@cdn.example.com/files",
      "file:///tmp/storage",
    ]) {
      expect(() =>
        createStorageNodeSchema.parse({
          name: "远端库",
          driver: "SFTP",
          basePath: "/data/media",
          host: "203.0.113.10",
          directAccessMode: "DIRECT",
          publicBaseUrl,
        }),
      ).toThrow(/public HTTP\(S\)|credentials|intranet/);
    }
  });
});

// === TR-037 R6: API route boundary migration tests ===
//
// These tests pin the behaviour of the new shared schemas that the 8
// storage routes now import. Each test corresponds to a route's previous
// inline `z.object({...})` and asserts the same key set, the same
// defaults, and the same string→boolean coercion for the `wait` /
// `download` query flags.

describe("TR-037 R6 storage route boundary schemas", () => {
  it("storageFileQuerySchema accepts empty input (both fields optional)", () => {
    const result = storageFileQuerySchema.parse({});
    expect(result).toEqual({});
  });

  it("storageFileQuerySchema keeps both fields when provided", () => {
    const result = storageFileQuerySchema.parse({
      nodeId: "node_1",
      path: "/srv/cloud/videos",
    });
    expect(result.nodeId).toBe("node_1");
    expect(result.path).toBe("/srv/cloud/videos");
  });

  it("contentDownloadQuerySchema defaults download to false", () => {
    const result = contentDownloadQuerySchema.parse({
      nodeId: "node_1",
      path: "/srv/cloud/videos",
    });
    expect(result.download).toBe(false);
  });

  it("contentDownloadQuerySchema accepts ?download=1 and ?download=true", () => {
    expect(contentDownloadQuerySchema.parse({ download: "1" }).download).toBe(true);
    expect(contentDownloadQuerySchema.parse({ download: "true" }).download).toBe(true);
  });

  it("sftpListQuerySchema defaults path to '/' when omitted", () => {
    const result = sftpListQuerySchema.parse({});
    expect(result.path).toBe("/");
  });

  it("sftpOpsActionSchema rejects unknown actions", () => {
    expect(() => sftpOpsActionSchema.parse("upload")).toThrow();
    expect(sftpOpsActionSchema.parse("read")).toBe("read");
  });

  it("sftpOpsBodySchema requires nodeId + action + path", () => {
    expect(() => sftpOpsBodySchema.parse({})).toThrow();
    expect(() =>
      sftpOpsBodySchema.parse({ nodeId: "node_1", action: "read" }),
    ).toThrow();
    const result = sftpOpsBodySchema.parse({
      nodeId: "node_1",
      action: "write",
      path: "/srv/cloud/file.txt",
      content: "hello",
    });
    expect(result.content).toBe("hello");
    expect(result.isDirectory).toBeUndefined();
  });

  it("sftpStaleInventoryBodySchema allows empty body (everything optional)", () => {
    const result = sftpStaleInventoryBodySchema.parse({});
    expect(result).toEqual({});
  });

  it("sftpStaleInventoryBodySchema bounds maxDepth 0-10", () => {
    expect(() =>
      sftpStaleInventoryBodySchema.parse({ maxDepth: 11 }),
    ).toThrow();
    expect(sftpStaleInventoryBodySchema.parse({ maxDepth: 0 }).maxDepth).toBe(0);
    expect(sftpStaleInventoryBodySchema.parse({ maxDepth: 10 }).maxDepth).toBe(10);
  });

  it("sftpStaleInventoryBodySchema bounds reason to 1-120 characters", () => {
    expect(() =>
      sftpStaleInventoryBodySchema.parse({ reason: "" }),
    ).toThrow();
    expect(() =>
      sftpStaleInventoryBodySchema.parse({ reason: "a".repeat(121) }),
    ).toThrow();
    expect(sftpStaleInventoryBodySchema.parse({ reason: "scheduled" }).reason).toBe(
      "scheduled",
    );
  });

  it("sftpSyncBodySchema requires nodeId", () => {
    expect(() => sftpSyncBodySchema.parse({})).toThrow();
    const result = sftpSyncBodySchema.parse({ nodeId: "node_1" });
    expect(result.nodeId).toBe("node_1");
    expect(result.recursive).toBeUndefined();
  });

  it("sftpSyncBodySchema bounds maxDepth 1-10", () => {
    expect(() => sftpSyncBodySchema.parse({ nodeId: "n", maxDepth: 0 })).toThrow();
    expect(() => sftpSyncBodySchema.parse({ nodeId: "n", maxDepth: 11 })).toThrow();
  });

  it("sftpWaitQuerySchema defaults wait to false when absent", () => {
    expect(sftpWaitQuerySchema.parse({}).wait).toBe(false);
  });

  it("sftpWaitQuerySchema coerces ?wait=1 and ?wait=true to true", () => {
    expect(sftpWaitQuerySchema.parse({ wait: "1" }).wait).toBe(true);
    expect(sftpWaitQuerySchema.parse({ wait: "true" }).wait).toBe(true);
  });

  it("directAccessInputSchema requires both nodeId and relativePath", () => {
    expect(() => directAccessInputSchema.parse({})).toThrow();
    expect(() => directAccessInputSchema.parse({ nodeId: "n" })).toThrow();
    const result = directAccessInputSchema.parse({
      nodeId: "node_1",
      relativePath: "videos/intro.mp4",
    });
    expect(result.relativePath).toBe("videos/intro.mp4");
  });

  it("directAccessDownloadQuerySchema defaults download to false", () => {
    expect(directAccessDownloadQuerySchema.parse({}).download).toBe(false);
  });

  it("directAccessDownloadQuerySchema coerces ?download=1 / ?download=true to true", () => {
    expect(directAccessDownloadQuerySchema.parse({ download: "1" }).download).toBe(true);
    expect(
      directAccessDownloadQuerySchema.parse({ download: "true" }).download,
    ).toBe(true);
  });
});
