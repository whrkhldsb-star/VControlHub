import { randomUUID } from "node:crypto";
import path from "node:path/posix";
import { type SFTPWrapper, type Stats } from "ssh2";
import { isInsideRoot } from "./sftp-root";
import { ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

export function sftpRequest<T>(send: (done: (error: Error | null | undefined, value: T) => void) => void) {
  return new Promise<T>((resolve, reject) => send((error, value) => error ? reject(error) : resolve(value)));
}

export async function sftpDeadline<T>(work: (progress: () => void) => Promise<T>, signal?: AbortSignal, timeoutMs = 15_000) {
  signal?.throwIfAborted();
  let timer: NodeJS.Timeout | undefined;
  const interrupted = Promise.withResolvers<never>();
  const abort = () => interrupted.reject(signal?.reason);
  const timeout = () => interrupted.reject(new Error(t("backend.ssh.connectionTimedOut")));
  let active = true;
  const progress = () => {
    if (!active) return;
    clearTimeout(timer);
    timer = setTimeout(timeout, timeoutMs);
  };
  signal?.addEventListener("abort", abort, { once: true });
  progress();
  try {
    return await Promise.race([interrupted.promise, work(progress)]);
  } finally {
    active = false;
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function uploadStageName() {
  return ".vch-upload-" + randomUUID() + ".tmp";
}

export async function atomicSftpWrite<T>(
  sftp: SFTPWrapper, destination: string,
  write: (stream: ReturnType<SFTPWrapper["createWriteStream"]>) => Promise<T>,
  root?: { path: string; windows: boolean },
  createMode = 0o666,
  signal?: AbortSignal,
) {
  function request<T>(send: (done: (error: Error | null | undefined, value: T) => void) => void) {
    return sftpDeadline(() => sftpRequest(send), signal);
  }
  const stat = (name: string) => request<Stats>(done => sftp.lstat(name, done)).catch(error => {
    if (error?.code === 2) return null;
    throw error;
  });
  const realpath = (name: string) => request<string>(done => sftp.realpath(name, done));
  const samePath = (left: string, right: string) =>
    isInsideRoot(left, right, root?.windows ?? false) && isInsideRoot(right, left, root?.windows ?? false);
  const parent = await realpath(path.dirname(destination));
  if (root && (!samePath(parent, path.dirname(destination)) || !isInsideRoot(parent, root.path, root.windows))) throw new ForbiddenError();
  destination = path.join(parent, path.basename(destination));
  let metadata = await stat(destination);
  if (metadata?.isSymbolicLink()) {
    if (root) throw new ForbiddenError();
    destination = await realpath(destination);
    metadata = await stat(destination);
  }
  if (metadata && !metadata.isFile()) throw new Error(t("backend.sftp.operationFailed"));
  const directory = path.dirname(destination);
  const tmp = path.join(directory, uploadStageName());
  async function checkStagePath() {
    if (!samePath(await realpath(directory), directory) || !samePath(await realpath(tmp), tmp)) throw new ForbiddenError();
  }
  const handle = await request<Buffer>(done => sftp.open(tmp, "wx", metadata ? 0o600 : createMode, done));
  let streamOwnsHandle = false;
  try {
    await checkStagePath();
    const stage = await request<Stats>(done => sftp.fstat(handle, done));
    // Remember the mode the server actually granted (including its umask).
    const finalMode = (metadata ?? stage).mode & 0o777;
    if ((stage.mode & 0o777) !== 0o600)
      await request<void>(done => sftp.fchmod(handle, 0o600, done));
    // ssh2's autoClose destroys the stream inside _final, before Node emits
    // finish. Close the remote handle after every write has been acknowledged.
    const stream = sftp.createWriteStream(tmp, { handle, autoClose: false });
    streamOwnsHandle = true;
    let finished = false;
    const metadataReady = Promise.withResolvers<void>();
    stream.once("finish", () => {
      finished = true;
      void (async () => {
        if (metadata && (stage.uid !== metadata.uid || stage.gid !== metadata.gid))
          await request<void>(done => sftp.fchown(handle, metadata.uid, metadata.gid, done));
        if (finalMode !== 0o600) await request<void>(done => sftp.fchmod(handle, finalMode, done));
      })().then(metadataReady.resolve, metadataReady.reject).finally(() => stream.destroy());
    });
    // The stream's caller can receive an error independently.
    void metadataReady.promise.catch(() => undefined);
    const abort = () => stream.destroy();
    signal?.addEventListener("abort", abort, { once: true });
    let result: T;
    try {
      result = await write(stream);
      signal?.throwIfAborted();
    } finally {
      if (!finished) stream.destroy();
      signal?.removeEventListener("abort", abort);
    }
    if (!finished) throw new Error(t("backend.sftp.operationFailed"));
    await metadataReady.promise;
    await checkStagePath();
    // SFTP v3 RENAME and OpenSSH POSIX_RENAME accept two pathnames. The
    // server cannot bind them to our open file or a directory handle. A
    // remote writer can still swap a directory after the last REALPATH,
    // or replace it with another directory of the same canonical name.
    await request<void>(done => metadata
      ? sftp.ext_openssh_rename(tmp, destination, done)
      : sftp.rename(tmp, destination, done));
    return result;
  } catch (error) {
    if (!streamOwnsHandle) await sftpDeadline(() => sftpRequest<void>(done => sftp.close(handle, done))).catch(() => undefined);
    await checkStagePath().then(() => sftpDeadline(() => sftpRequest<void>(done => sftp.unlink(tmp, done)))).catch(() => undefined);
    throw error;
  }
}
