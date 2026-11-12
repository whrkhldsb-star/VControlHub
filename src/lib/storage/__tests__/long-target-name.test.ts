// @vitest-environment node
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

// Lets one test refuse the move of a given source, as another filesystem would.
const unmovable = vi.hoisted(() => ({ source: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const rename: typeof actual.rename = async (from, to) => {
    if (from === unmovable.source) throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
    return actual.rename(from, to);
  };
  return { ...actual, default: { ...actual, rename }, rename };
});

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

describe("a staged upload reaching a LOCAL node", () => {
  // Chunks, then the assembled file, then a copy of it into the node: a 200 MB upload was written three
  // times. Staging and the default storage root share a filesystem, where the last one is a rename.
  it.runIf(process.platform !== "win32")("is moved into place rather than written again, with the node's file mode", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "staged-move-"));
    try {
      const source = path.join(root, "staging", "assembled.tmp");
      mkdirSync(path.dirname(source));
      writeFileSync(source, "payload", { mode: 0o600 });
      const inode = statSync(source).ino;
      mkdirSync(path.join(root, "store"));
      chmodSync(path.join(root, "store"), 0o755);

      await writeStorageFileFromLocalPath({ driver: "LOCAL", basePath: path.join(root, "store") } as never, "report.pdf", source);

      const target = path.join(root, "store", "report.pdf");
      expect(readFileSync(target, "utf8")).toBe("payload");
      expect(statSync(target).ino).toBe(inode);
      expect(existsSync(source)).toBe(false);
      // Staged as 0600: served by another account it answered 403 (A4-01).
      expect(statSync(target).mode & 0o777).toBe(0o644);
      expect(readdirSync(path.join(root, "store"))).toEqual(["report.pdf"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is copied where it cannot be moved (staging on another filesystem), and the source is left to its owner", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "staged-copy-"));
    try {
      const source = path.join(root, "assembled.tmp");
      writeFileSync(source, "payload");
      unmovable.source = source;

      await writeStorageFileFromLocalPath({ driver: "LOCAL", basePath: path.join(root, "store") } as never, "docs/report.pdf", source);

      expect(readFileSync(path.join(root, "store", "docs", "report.pdf"), "utf8")).toBe("payload");
      expect(readFileSync(source, "utf8")).toBe("payload");
      expect(readdirSync(path.join(root, "store", "docs"))).toEqual(["report.pdf"]);
    } finally {
      unmovable.source = "";
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
