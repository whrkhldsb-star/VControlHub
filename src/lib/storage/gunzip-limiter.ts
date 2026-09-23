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
