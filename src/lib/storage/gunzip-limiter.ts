import { createReadStream } from "node:fs";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

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

  /** Bytes passed through so far. */
  get bytes() {
    return this.totalBytes;
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
 * The decompressed size of a whole gzip file, counted by decompressing it
 * without writing anything (and capped like the real extraction). The
 * trailer only names the last member's size: a file of several members,
 * such as logs joined with cat, was refused as too large however small.
 */
export async function countGunzipOutput(filePath: string, maxBytes: number, limitMessage: string): Promise<number> {
  const limiter = new GunzipOutputLimiter(maxBytes, limitMessage);
  await pipeline(createReadStream(filePath), createGunzip(), limiter, new Writable({ write: (_chunk, _encoding, done) => done() }));
  return limiter.bytes;
}
