// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

const { copyStorageFile, writeStorageFileFromLocalPath } = await import("../file-content");

describe("writeStorageFileFromLocalPath on a LOCAL node", () => {
  it("writes a target whose name nearly fills the 255-byte limit", async () => {
    // The temporary copy used to be the target's name plus 52 characters, which a 244-byte name cannot carry.
    const root = mkdtempSync(path.join(tmpdir(), "long-name-"));
    try {
      const source = path.join(root, "source.bin");
      writeFileSync(source, "payload");
      const name = `${"长".repeat(80)}.pdf`;
      await writeStorageFileFromLocalPath({ driver: "LOCAL", basePath: path.join(root, "store") } as never, `docs/${name}`, source);
      expect(readFileSync(path.join(root, "store", "docs", name), "utf8")).toBe("payload");
      // No temporary file is left beside it.
      expect(readdirSync(path.join(root, "store", "docs"))).toEqual([name]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("copyStorageFile on a LOCAL node", () => {
  it("copies to a target whose name nearly fills the 255-byte limit", async () => {
    // The temporary copy was the destination's name plus 50 characters: a WebDAV COPY of a file with a long
    // (for instance Chinese) name failed with ENAMETOOLONG although the name itself is valid.
    const root = mkdtempSync(path.join(tmpdir(), "long-copy-"));
    try {
      const name = `${"长".repeat(80)}.pdf`;
      mkdirSync(path.join(root, "store", "docs"), { recursive: true });
      writeFileSync(path.join(root, "store", "docs", name), "payload");
      const result = await copyStorageFile({ driver: "LOCAL", basePath: path.join(root, "store") } as never, `docs/${name}`, `copies/${name}`);
      expect(result.size).toBe(7);
      expect(readFileSync(path.join(root, "store", "copies", name), "utf8")).toBe("payload");
      // No temporary file is left beside it.
      expect(readdirSync(path.join(root, "store", "copies"))).toEqual([name]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
