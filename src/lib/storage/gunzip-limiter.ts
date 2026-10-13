import { Transform } from "node:stream";

import { AppError } from "@/lib/errors";

/**
 * Hard cap on decompressed output — a decompression-bomb guard. Without it a
 * few-hundred-MB .gz could expand unbounded onto the node's disk (gzip ratios
 * reach ~1000x) before any post-hoc size check ran.
 */
export const MAX_GUNZIP_OUTPUT_BYTES = 1024 * 1024 * 1024; // 1 GiB

/** Counting Transform that destroys the pipeline once the cap is exceeded. */
export class GunzipOutputLimiter extends Transform {
  private totalBytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly limitMessage: string,
  ) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ) {
    this.totalBytes += chunk.length;
    if (this.totalBytes > this.maxBytes) {
      callback(
        new AppError({
          code: "REQUEST_ENTITY_TOO_LARGE",
          message: this.limitMessage,
          status: 413,
        }),
      );
      return;
    }
    callback(null, chunk);
  }
}

/**
 * Decompressed size recorded in a gzip trailer (ISIZE, the last four bytes,
 * little-endian, modulo 2^32). Exact for every output the limiter above would
 * accept; for a concatenated multi-member file it describes the last member
 * only, so it admits a write but never replaces the limiter. Null when the
 * file is too short to be gzip or cannot be read.
 */
export async function readGzipDecompressedSize(filePath: string): Promise<number | null> {
  const { open } = await import("node:fs/promises");
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, "r");
    const { size } = await handle.stat();
    if (size < 18) return null;
    const trailer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(trailer, 0, 4, size - 4);
    return bytesRead === 4 ? trailer.readUInt32LE(0) : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
