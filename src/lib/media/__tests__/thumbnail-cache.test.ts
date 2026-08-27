import { mkdtemp, mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { configMock } = vi.hoisted(() => ({
  configMock: { media: { thumbCacheDir: undefined as string | undefined } },
}));

vi.mock("@/lib/config/env", () => ({ config: configMock }));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { pruneThumbnailCache, thumbnailCacheRoot } = await import(
  "../thumbnail-cache"
);

const DAY_MS = 24 * 60 * 60 * 1000;
let root: string;

async function writeThumb(name: string, ageMs = 0) {
  const filePath = path.join(root, name);
  await writeFile(filePath, "jpeg-bytes");
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    await utimes(filePath, when, when);
  }
  return filePath;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "thumb-cache-test-"));
  configMock.media.thumbCacheDir = root;
});

afterEach(() => {
  configMock.media.thumbCacheDir = undefined;
});

describe("thumbnailCacheRoot", () => {
  it("falls back to a tmpdir subdirectory when unconfigured", () => {
    configMock.media.thumbCacheDir = undefined;
    expect(thumbnailCacheRoot()).toBe(
      path.join(os.tmpdir(), "vcontrolhub-thumbnails"),
    );
  });
});

describe("pruneThumbnailCache", () => {
  it("is a no-op when no thumbnail has ever been generated", async () => {
    configMock.media.thumbCacheDir = path.join(root, "never-created");
    await expect(pruneThumbnailCache()).resolves.toEqual({
      deleted: 0,
      retained: 0,
    });
  });

  it("drops files past the age cap and keeps fresh ones", async () => {
    await writeThumb("fresh.jpg");
    await writeThumb("stale.jpg", 40 * DAY_MS);

    const result = await pruneThumbnailCache({ maxAgeMs: 30 * DAY_MS });

    expect(result).toEqual({ deleted: 1, retained: 1 });
    expect(await readdir(root)).toEqual(["fresh.jpg"]);
  });

  it("enforces the entry ceiling oldest-first", async () => {
    await writeThumb("oldest.jpg", 3 * DAY_MS);
    await writeThumb("middle.jpg", 2 * DAY_MS);
    await writeThumb("newest.jpg", 1 * DAY_MS);

    const result = await pruneThumbnailCache({ maxEntries: 1 });

    expect(result).toEqual({ deleted: 2, retained: 1 });
    expect(await readdir(root)).toEqual(["newest.jpg"]);
  });

  it("never touches entries this cache did not write", async () => {
    await writeThumb("stale.jpg", 40 * DAY_MS);
    await writeFile(path.join(root, "notes.txt"), "unrelated");
    await mkdir(path.join(root, "nested"));

    const result = await pruneThumbnailCache({ maxAgeMs: 1 });

    expect(result.deleted).toBe(1);
    expect((await readdir(root)).sort()).toEqual(["nested", "notes.txt"]);
  });
});
