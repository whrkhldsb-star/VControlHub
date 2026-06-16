import { describe, expect, it } from "vitest";

import {
  archiveListQuerySchema,
  listFilesQuerySchema,
  saveEditableFileBodySchema,
} from "@/lib/files/schema";

describe("files schema", () => {
  describe("archiveListQuerySchema", () => {
    it("defaults driver to LOCAL and name to 'archive'", () => {
      const parsed = archiveListQuerySchema.parse({});
      expect(parsed.driver).toBe("LOCAL");
      expect(parsed.name).toBe("archive");
    });

    it("accepts an explicit SFTP driver (route rejects with 400)", () => {
      const parsed = archiveListQuerySchema.parse({
        driver: "SFTP",
        nodeId: "node_1",
        relativePath: "/srv/archive.zip",
        name: "snapshot",
      });
      expect(parsed.driver).toBe("SFTP");
      expect(parsed.nodeId).toBe("node_1");
      expect(parsed.relativePath).toBe("/srv/archive.zip");
      expect(parsed.name).toBe("snapshot");
    });

    it("rejects an unknown driver", () => {
      const result = archiveListQuerySchema.safeParse({ driver: "NFS" });
      expect(result.success).toBe(false);
    });

    it("trims whitespace from string fields", () => {
      const parsed = archiveListQuerySchema.parse({
        nodeId: "  node_1  ",
        relativePath: "  /srv/archive.zip  ",
        name: "  snapshot  ",
      });
      expect(parsed.nodeId).toBe("node_1");
      expect(parsed.relativePath).toBe("/srv/archive.zip");
      expect(parsed.name).toBe("snapshot");
    });

    it("rejects an empty name when explicitly provided", () => {
      const result = archiveListQuerySchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("listFilesQuerySchema", () => {
    it("defaults scope to 'current' and omits path / q / nodeId", () => {
      const parsed = listFilesQuerySchema.parse({});
      expect(parsed.scope).toBe("current");
      expect(parsed.path).toBeUndefined();
      expect(parsed.q).toBeUndefined();
      expect(parsed.nodeId).toBeUndefined();
    });

    it("accepts an explicit path / q / scope / nodeId combination", () => {
      const parsed = listFilesQuerySchema.parse({
        path: "/srv/whrkhldsb",
        q: "docker",
        scope: "all",
        nodeId: "node_1",
      });
      expect(parsed.path).toBe("/srv/whrkhldsb");
      expect(parsed.q).toBe("docker");
      expect(parsed.scope).toBe("all");
      expect(parsed.nodeId).toBe("node_1");
    });

    it("rejects a path shorter than 1 character when provided", () => {
      const result = listFilesQuerySchema.safeParse({ path: "" });
      expect(result.success).toBe(false);
    });

    it("rejects an unknown scope", () => {
      const result = listFilesQuerySchema.safeParse({ scope: "recursive" });
      expect(result.success).toBe(false);
    });
  });

  describe("saveEditableFileBodySchema", () => {
    it("accepts a fresh draft with only content", () => {
      const parsed = saveEditableFileBodySchema.parse({
        content: "hello world",
      });
      expect(parsed.content).toBe("hello world");
      expect(parsed.expectedUpdatedAt).toBeUndefined();
      expect(parsed.expectedLastModifiedMs).toBeUndefined();
    });

    it("accepts optimistic-concurrency tokens", () => {
      const parsed = saveEditableFileBodySchema.parse({
        content: "v2",
        expectedUpdatedAt: "2026-06-16T08:00:00.000Z",
        expectedLastModifiedMs: 1718528400000,
      });
      expect(parsed.expectedUpdatedAt).toBe("2026-06-16T08:00:00.000Z");
      expect(parsed.expectedLastModifiedMs).toBe(1718528400000);
    });

    it("rejects content over 512 KB", () => {
      const result = saveEditableFileBodySchema.safeParse({
        content: "x".repeat(512 * 1024 + 1),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/512 KB/);
      }
    });

    it("accepts content exactly at the 512 KB limit", () => {
      const result = saveEditableFileBodySchema.safeParse({
        content: "x".repeat(512 * 1024),
      });
      expect(result.success).toBe(true);
    });

    it("rejects a non-ISO expectedUpdatedAt", () => {
      const result = saveEditableFileBodySchema.safeParse({
        content: "v2",
        expectedUpdatedAt: "yesterday",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a negative expectedLastModifiedMs", () => {
      const result = saveEditableFileBodySchema.safeParse({
        content: "v2",
        expectedLastModifiedMs: -1,
      });
      expect(result.success).toBe(false);
    });
  });
});
