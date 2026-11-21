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
  let metadata = await stat(destination);
  if (metadata?.isSymbolicLink()) {
    destination = await request<string>(done => sftp.realpath(destination, done));
    if (root && !isInsideRoot(destination, root.path, root.windows)) throw new ForbiddenError();
    metadata = await stat(destination);
  }
  if (metadata && !metadata.isFile()) throw new Error(t("backend.sftp.operationFailed"));
  const tmp = path.join(path.dirname(destination), ".vch-upload-" + randomUUID());
  const handle = await request<Buffer>(done => sftp.open(tmp, "wx", metadata ? 0o600 : createMode, done));
  let streamOwnsHandle = false;
  try {
    const stage = await request<Stats>(done => sftp.fstat(handle, done));
    // Remember the mode the server actually granted (including its umask).
    const finalMode = (metadata ?? stage).mode & 0o777;
    if ((stage.mode & 0o777) !== 0o600)
      await request<void>(done => sftp.fchmod(handle, 0o600, done));
    const stream = sftp.createWriteStream(tmp, { handle, autoClose: true });
    streamOwnsHandle = true;
    let finished = false;
    stream.once("finish", () => { finished = true; });
    const abort = () => stream.destroy();
    signal?.addEventListener("abort", abort, { once: true });
    let result: T;
    try {
      result = await write(stream);
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    if (!finished) throw new Error(t("backend.sftp.operationFailed"));
    if (metadata && (stage.uid !== metadata.uid || stage.gid !== metadata.gid))
      await request<void>(done => sftp.chown(tmp, metadata.uid, metadata.gid, done));
    if (finalMode !== 0o600)
      await request<void>(done => sftp.chmod(tmp, finalMode, done));
    await request<void>(done => metadata
      ? sftp.ext_openssh_rename(tmp, destination, done)
      : sftp.rename(tmp, destination, done));
    return result;
  } catch (error) {
    if (!streamOwnsHandle) await sftpDeadline(() => sftpRequest<void>(done => sftp.close(handle, done))).catch(() => undefined);
    await sftpDeadline(() => sftpRequest<void>(done => sftp.unlink(tmp, done))).catch(() => undefined);
    throw error;
  }
}
