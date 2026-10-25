import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import type { Readable } from "node:stream";
import path from "node:path";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { apiCopy } from "@/lib/i18n/api-copy";

/**
 * Open a folder archive without the recycle bin's contents. Both public shares
 * and authenticated downloads must use this gate. Exclusions are literal
 * archive member paths; a deleted directory excludes its subtree.
 *
 * The deletion list is one consistent read taken before tar starts. The node's
 * file-operation lock is not held while the archive streams: it was, which
 * made every delete, move, restore and other folder download on the node fail
 * as busy for as long as one download ran, and pinned one of the few
 * advisory-lock connections per download. A tree changed under a running tar
 * makes tar exit non-zero, which fails the download (archive-stream) rather
 * than handing over a wrong archive; a file deleted after the list was read
 * may still be in it, as it would be in a download started a moment earlier.
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
        { relativePath: { startsWith: escapeLikeLiteral(`${input.relativePath}/`) } },
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
  const abort = () => {
    stream.destroy();
  };
  const finish = () => input.signal.removeEventListener("abort", abort);
  stream.once("end", finish);
  stream.once("error", finish);
  stream.once("close", finish);
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) abort();
  return stream;
}
