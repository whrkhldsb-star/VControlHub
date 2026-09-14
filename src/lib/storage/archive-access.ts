import type { Readable } from "node:stream";
import path from "node:path";
import { prisma } from "@/lib/db";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { apiCopy } from "@/lib/i18n/api-copy";
import { createLogger } from "@/lib/logging";

const logger = createLogger("storage:archive-access");

/** Keep the deletion snapshot stable until tar has finished reading the tree.
 * Both public shares and authenticated downloads must use this gate. Exclusions
 * are literal archive member paths; a deleted directory excludes its subtree.
 */
export async function openManagedArchive(input: {
  storageNodeId: string;
  relativePath: string;
  signal: AbortSignal;
  open: (
    excluded: string[],
  ) => NodeJS.ReadableStream | Promise<NodeJS.ReadableStream>;
}): Promise<NodeJS.ReadableStream> {
  input.signal.throwIfAborted();
  const release = await tryAcquireAdvisoryLock(
    "storage-file-operation",
    input.storageNodeId,
  );
  if (!release) throw new ValidationError(apiCopy("apiCopy.files.op.busy"));
  let handedOff = false;
  try {
    input.signal.throwIfAborted();
    const parts = input.relativePath.split("/");
    const ancestors = parts.map((_, index) =>
      parts.slice(0, index + 1).join("/"),
    );
    const deleted = await prisma.fileEntry.findMany({
      where: {
        storageNodeId: input.storageNodeId,
        isDeleted: true,
        OR: [
          { relativePath: { in: ancestors } },
          { relativePath: { startsWith: `${input.relativePath}/` } },
        ],
      },
      select: { relativePath: true },
      take: 10001,
    });
    if (deleted.length > 10000)
      throw new ValidationError(apiCopy("apiCopy.files.op.entries"));
    if (deleted.some((entry) => ancestors.includes(entry.relativePath)))
      throw new NotFoundError(apiCopy("apiCopy.files.op.missing"));
    const name = path.posix.basename(input.relativePath);
    const excluded = deleted.map((entry) => {
      if (!entry.relativePath.startsWith(`${input.relativePath}/`))
        throw new ValidationError(apiCopy("apiCopy.files.op.invalid"));
      return name + entry.relativePath.slice(input.relativePath.length);
    });
    input.signal.throwIfAborted();
    const stream = (await input.open(excluded)) as Readable;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      input.signal.removeEventListener("abort", abort);
      void release().catch((error) =>
        logger.error("archive lock release failed", error),
      );
    };
    const abort = () => {
      stream.destroy();
    };
    stream.once("end", finish);
    stream.once("error", finish);
    stream.once("close", finish);
    input.signal.addEventListener("abort", abort, { once: true });
    handedOff = true;
    if (input.signal.aborted) abort();
    if (stream.destroyed || stream.readableEnded) finish();
    return stream;
  } finally {
    if (!handedOff) await release();
  }
}
