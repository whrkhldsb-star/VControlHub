import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readGzipDecompressedSize } from "../gunzip-limiter";

describe("readGzipDecompressedSize", () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), "vch-gz-size-")); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it("reads the decompressed size from the trailer", async () => {
    const payload = Buffer.alloc(123_457, "x");
    const file = path.join(dir, "a.gz");
    await writeFile(file, gzipSync(payload));
    expect(await readGzipDecompressedSize(file)).toBe(123_457);
  });

  it("returns null for a file too short to be gzip or a missing file", async () => {
    const file = path.join(dir, "short.gz");
    await writeFile(file, Buffer.from("tiny"));
    expect(await readGzipDecompressedSize(file)).toBeNull();
    expect(await readGzipDecompressedSize(path.join(dir, "missing.gz"))).toBeNull();
  });
});
