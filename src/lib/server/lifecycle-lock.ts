import { AsyncLocalStorage } from "node:async_hooks";
import type { Readable } from "node:stream";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";

type Operation = { serverId: string; mode: "exclusive" | "shared"; held: boolean; stream?: Readable };
const operations = new AsyncLocalStorage<Operation>();

async function runWithServerLifecycleLock<T>(
  serverId: string,
  mode: "exclusive" | "shared",
  work: () => Promise<T>,
): Promise<T> {
  const current = operations.getStore();
  if (current?.held && current.serverId === serverId) {
    if (mode === "shared" || current.mode === "exclusive") return work();
    throw new Error(`Cannot upgrade shared server lifecycle lock to exclusive for server ${serverId}`);
  }
  const release = mode === "shared"
    ? await acquireAdvisoryLock("server-delete", serverId, { shared: true })
    : await acquireAdvisoryLock("server-delete", serverId);
  const operation: Operation = { serverId, mode, held: true };
  try {
    return await operations.run(operation, work);
  } catch (error) {
    operation.stream?.destroy();
    throw error;
  } finally {
    operation.held = false;
    const stream = operation.stream;
    if (stream && !stream.closed && !stream.readableEnded) {
      stream.once("close", release);
      stream.once("end", release);
    } else {
      await release();
    }
  }
}

/** Nested commands share the operation's transfer lock until the outermost caller finishes. */
export async function withServerLifecycleLock<T>(serverId: string, work: () => Promise<T>): Promise<T> {
  return runWithServerLifecycleLock(serverId, "exclusive", work);
}

/** Shared server lifecycle lock for read-only / concurrent operations that only need to fence delete/transfer. */
export async function withServerLifecycleSharedLock<T>(serverId: string, work: () => Promise<T>): Promise<T> {
  return runWithServerLifecycleLock(serverId, "shared", work);
}

export function holdServerLockForDownload(stream: Readable) {
  const operation = operations.getStore();
  if (operation?.held) operation.stream = stream;
}
