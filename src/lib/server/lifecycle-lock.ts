import { AsyncLocalStorage } from "node:async_hooks";
import type { Readable } from "node:stream";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";

type Operation = { serverId: string; held: boolean; stream?: Readable };
const operations = new AsyncLocalStorage<Operation>();

/** Nested commands share the operation's transfer lock until the outermost caller finishes. */
export async function withServerLifecycleLock<T>(serverId: string, work: () => Promise<T>): Promise<T> {
  const current = operations.getStore();
  if (current?.held && current.serverId === serverId) return work();
  const release = await acquireAdvisoryLock("server-delete", serverId);
  const operation: Operation = { serverId, held: true };
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

export function holdServerLockForDownload(stream: Readable) {
  const operation = operations.getStore();
  if (operation?.held) operation.stream = stream;
}
