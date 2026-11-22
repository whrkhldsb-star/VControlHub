import { Readable } from "node:stream";
import type { ClientChannel } from "ssh2";
import { ForbiddenError, BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { shellQuote } from "@/lib/shell-quote";
import { windowsSftpPathToNative, WINDOWS_FINAL_PATH_TYPE } from "@/lib/server/windows-direct-gateway";
import { AGENT_FILE_MAX_BYTES, connectSsh, createVerifiedSshConfig, execRemoteCommand, type SshConnectionParams } from "./client";
import { sftpDeadline } from "./sftp-operations";
import { SFTP_TRANSFER_IDLE_TIMEOUT_MS } from "./sftp-timeout";

// The login may follow a link within its home. Open the previously authorized canonical
// path component by component so a renamed ancestor cannot redirect the actual open.
const linuxReader = () => `import base64,os,pwd,stat,sys
root,target,mode,user=sys.argv[1:]
# A chrooted SFTP subsystem and an exec channel can expose different namespaces.
# Re-establish the login root in the namespace that actually opens the descriptor.
if os.path.realpath(pwd.getpwnam(user).pw_dir)!=root: sys.exit(1)
if os.path.commonpath([root,target])!=root: sys.exit(1)
parts=target.split('/')[1:]
if not parts or any(p in ('.','..','') for p in parts): sys.exit(1)
flags=os.O_RDONLY|os.O_NOFOLLOW
fd=os.open('/',flags|os.O_DIRECTORY)
for name in parts[:-1]:
 child=os.open(name,flags|os.O_DIRECTORY,dir_fd=fd)
 os.close(fd)
 fd=child
with os.fdopen(os.open(parts[-1],flags|os.O_NONBLOCK,dir_fd=fd),'rb') as f:
 st=os.fstat(f.fileno())
 if not stat.S_ISREG(st.st_mode): sys.exit(1)
 if mode=='agent':
  if st.st_size>${AGENT_FILE_MAX_BYTES}: sys.exit(2)
  data=f.read(st.st_size+1)
  if len(data)!=st.st_size: sys.exit(1)
  print(st.st_size)
  print(base64.b64encode(data).decode())
 else:
  print(st.st_size,flush=True)
  left=st.st_size
  while left:
   chunk=f.read(min(left,65536))
   if not chunk: sys.exit(1)
   sys.stdout.buffer.write(chunk)
   left-=len(chunk)`;

function windowsReader(root: string, file: string) {
  const literal = (value: string) => "'" + windowsSftpPathToNative(value.replaceAll("\\", "/").replace(/^\/?/, "/")).replaceAll("'", "''") + "'";
  const program = `$ErrorActionPreference='Stop'
${WINDOWS_FINAL_PATH_TYPE}
$stream=[IO.File]::OpenRead(${literal(file)})
try {
  $path=New-Object Text.StringBuilder 32768
  $length=[VchFinalPath]::GetFinalPathNameByHandle($stream.SafeFileHandle,$path,32768,0)
  if (!$length -or $length -ge 32768) { exit 1 }
  $final=$path.ToString()
  if ($final.StartsWith('\\\\?\\')) { $final=$final.Substring(4) }
  if (!$final.StartsWith(${literal(root)}+[char]92,[StringComparison]::OrdinalIgnoreCase)) { exit 1 }
  $out=[Console]::OpenStandardOutput()
  $header=[Text.Encoding]::ASCII.GetBytes([string]$stream.Length+[char]10)
  $out.Write($header,0,$header.Length)
  $stream.CopyTo($out)
} finally { $stream.Dispose() }`;
  return "powershell.exe -NoProfile -NonInteractive -EncodedCommand " + Buffer.from(program, "utf16le").toString("base64");
}

export async function downloadRestrictedFile(conn: SshConnectionParams, root: { path: string; windows: boolean }, file: string, signal?: AbortSignal) {
  const agent = Boolean(conn.agentServerId && !conn.privateKey && !conn.password);
  // Keep Python imports independent of the remote login's writable working directory and user site.
  const command = root.windows ? windowsReader(root.path, file)
    : ["python3", "-I", "-c", linuxReader(), root.path, file, agent ? "agent" : "stream", conn.username].map(shellQuote).join(" ");
  if (agent) {
    const answer = await execRemoteCommand({ ...conn, command, signal });
    if (answer.exitCode === 2) throw new BusinessError(t("backend.server.agentReadLimit"));
    if (answer.exitCode !== 0) throw new ForbiddenError();
    const [length, encoded] = answer.stdout.trimEnd().split("\n");
    const size = Number(length);
    if (!/^\d+$/.test(length ?? "") || !Number.isSafeInteger(size) || size > AGENT_FILE_MAX_BYTES) {
      throw new ForbiddenError();
    }
    const data = Buffer.from(encoded ?? "", "base64");
    if (data.length !== size || (encoded?.length ?? 0) !== 4 * Math.ceil(size / 3)) {
      throw new BusinessError(t("backend.server.agentFileSizeChanged"));
    }
    return { stream: Readable.from([data]), size: data.length };
  }
  signal?.throwIfAborted();
  const client = await connectSsh(createVerifiedSshConfig({ ...conn, enforceHostKeyPin: true }));
  let stream: Readable | undefined;
  let idle: NodeJS.Timeout | undefined;
  const abort = () => { client.destroy(); stream?.destroy(); };
  signal?.addEventListener("abort", abort, { once: true });
  const close = () => {
    clearTimeout(idle);
    signal?.removeEventListener("abort", abort);
    client.destroy();
  };
  try {
    const channel = await sftpDeadline(() => new Promise<ClientChannel>((resolve, reject) =>
      client.exec(command, (error, stream) => error ? reject(error) : resolve(stream))), signal);
    channel.stderr.resume();
    const bytes = channel[Symbol.asyncIterator]();
    let header = Buffer.alloc(0);
    const next = () => sftpDeadline(() => bytes.next(), signal, SFTP_TRANSFER_IDLE_TIMEOUT_MS);
    while (!header.includes(10)) {
      const part = await next();
      if (part.done || header.length > 20) throw new ForbiddenError();
      header = Buffer.concat([header, part.value]);
    }
    const split = header.indexOf(10);
    const length = header.subarray(0, split).toString("ascii");
    if (!/^\d{1,16}$/.test(length) || !Number.isSafeInteger(Number(length))) throw new ForbiddenError();
    const size = Number(length);
    // An idle consumer can stop pulling before the SSH channel needs another
    // read. Bound the transport and its handover registration in that case too.
    const refresh = () => {
      clearTimeout(idle);
      idle = setTimeout(abort, SFTP_TRANSFER_IDLE_TIMEOUT_MS);
      idle.unref();
    };
    stream = Readable.from((async function* () {
      let sent = 0;
      let chunk = header.subarray(split + 1);
      while (true) {
        sent += chunk.length;
        if (sent > size) throw new ForbiddenError();
        refresh();
        if (chunk.length) yield chunk;
        const part = await next();
        if (part.done) break;
        chunk = part.value;
      }
      if (sent !== size) throw new BusinessError(t("backend.server.agentFileSizeChanged"));
    })());
    stream.once("close", close);
    refresh();
    return { stream, size };
  } catch (error) {
    close();
    throw error;
  }
}
