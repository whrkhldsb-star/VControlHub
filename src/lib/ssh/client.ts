import { NO_REPLACE_RENAME_PYTHON } from "./rename-exclusive";
import { Client, type ConnectConfig } from "ssh2";
import { getSshEnforceHostKeyPin } from "@/lib/settings/cached-flags";
import { uploadStageName, atomicSftpWrite, sftpDeadline, sftpRequest } from "./sftp-operations";
import { SFTP_TRANSFER_IDLE_TIMEOUT_MS } from "./sftp-timeout";
import { isInsideRoot } from "./sftp-root";
import type { FileEntryWithStats, SFTPWrapper } from "ssh2";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { BusinessError } from "@/lib/errors";
import { config as appConfig } from "@/lib/config/env";
import { shellQuote } from "@/lib/shell-quote";
import { t } from "@/lib/i18n/service-translations";

import { decryptServerPassword, decryptStoredSshKey, type StoredSshKey } from "@/lib/ssh/ssh-key-crypto";

export type SshConnectionParams = {
  signal?: AbortSignal;
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  passphrase?: string;
  password?: string;
  hostKeySha256?: string | null;
  /** Credential verification must perform a new SSH handshake. */
  freshConnection?: boolean;
  /** Capture the remote SHA256 host key hash during TOFU discovery. */
  onHostKeySha256?: (fingerprint: string) => void;
  /** Abort immediately after host-key capture so first-contact TOFU never sends credentials. */
  rejectUnknownHostKeyAfterCapture?: boolean;
  /** OPEN-1: When true, reject connection if hostKeySha256 is not pinned.
   *  The fingerprint is still captured via onHostKeySha256 before rejection. */
  enforceHostKeyPin?: boolean;
  /** Agent transport fallback used when no SSH credential is stored. */
  agentServerId?: string;
  /** Server identity captured when loading a tenant-authorized operation. */
  expectedIdentity?: { serverId: string; teamId: string | null; tokenHash: string | null; endpoint?: { host: string; port: number; username: string; hostKeySha256: string | null } };
};

export type SftpListEntry = {
 name: string;
 longname: string;
 /** The entry itself (lstat): a symbolic link is "other", never followed. */
 type: "file" | "directory" | "other";
 /** The entry is a symbolic link; `type` still describes the link, not its target. */
 symlink?: boolean;
 size: number;
 modifyTime: number;
 accessTime: number;
};

export type SftpStatEntry = {
  mode: number;
  size: number;
  type: "file" | "directory" | "other";
  modifyTime: number;
  accessTime: number;
};

/**
 * Strip the optional `SHA256:` prefix from an OpenSSH fingerprint so the raw
 * base64 digest can be compared with ssh2's hostkey.format().digest output.
 * (The inverse of `canonicalHostKeyFingerprint` in ./host-key, which keeps the
 * prefix — same old name, opposite behaviour, hence the split names.)
 */
function stripHostKeyFingerprintPrefix(fingerprint?: string | null): string | null {
 const value = fingerprint?.trim();
 if (!value) return null;
 return value.replace(/^SHA256:/i, "");
}

function standardSha256Fingerprint(hexDigest: string): string | null {
 const normalized = hexDigest.trim();
 if (!/^[a-f0-9]{64}$/i.test(normalized)) return null;
 return Buffer.from(normalized, "hex").toString("base64").replace(/=+$/, "");
}

function createSshConfig(input: SshConnectionParams): ConnectConfig {
 const expectedHostKey = stripHostKeyFingerprintPrefix(input.hostKeySha256);
 if (input.enforceHostKeyPin && !expectedHostKey && !(input.onHostKeySha256 && input.rejectUnknownHostKeyAfterCapture)) {
   throw new BusinessError(t("backend.ssh.hostKeyNotPinned"));
 }
 const config: ConnectConfig = {
  host: input.host,
  port: input.port,
  username: input.username,
  readyTimeout: 15000,
  timeout: 10000,
  // Pooled connections idle up to the pool timeout. Without keepalives one
  // that a NAT or firewall dropped silently was found dead only by the next
  // request, which stalled until TCP gave up (often 15 minutes or more): the
  // file manager or a health sample looked hung. ssh2 closes a connection
  // that misses this many keepalives, and the pool then replaces it.
  keepaliveInterval: appConfig.ssh.keepaliveIntervalMs,
  keepaliveCountMax: appConfig.ssh.keepaliveCountMax,
 };

 if (input.privateKey) {
   config.privateKey = input.privateKey;
   if (input.passphrase) config.passphrase = input.passphrase;
 } else if (input.password) {
  config.password = input.password;
 }

 const enforceHostKeyPin = input.enforceHostKeyPin ?? getSshEnforceHostKeyPin();
 const needsVerifier = expectedHostKey || input.onHostKeySha256 || enforceHostKeyPin;
 if (needsVerifier) {
  config.hostHash = "sha256";
  config.hostVerifier = (hashedKey: string) => {
   const actualHex = hashedKey.trim();
   const actualStandard = standardSha256Fingerprint(actualHex);
   input.onHostKeySha256?.(`SHA256:${actualStandard ?? actualHex}`);
   if (expectedHostKey) {
    // ssh2 supplies a hex digest, while OpenSSH/cloud consoles use the
    // standard unpadded Base64 SHA256 fingerprint. Keep legacy hex pins valid.
    return expectedHostKey === (actualStandard ?? actualHex) || expectedHostKey.toLowerCase() === actualHex.toLowerCase();
   }
   // OPEN-1: No pinned key — if enforceHostKeyPin is set, reject to force
   // explicit approval. Otherwise accept (backward-compatible TOFU).
   if (enforceHostKeyPin) return false;
   return !input.rejectUnknownHostKeyAfterCapture;
  };
 }

 return config;
}

/** Public SSH connect-config builder (host-key pin/TOFU handled inside createSshConfig). */
export function createVerifiedSshConfig(input: SshConnectionParams): ConnectConfig {
  return createSshConfig(input);
}

export function connectSsh(config: ConnectConfig | SshConnectionParams): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    // Pooled connections multiplex concurrent operations, each registering its
    // own close/end/error listeners (removed on settle — see
    // execCommandOnClient). The default 10-listener cap produces spurious
    // MaxListenersExceededWarning noise from ~4 concurrent commands.
    client.setMaxListeners(0);
    client.on("ready", () => resolve(client));
    client.on("error", (err) => reject(err));
    client.connect("hostKeySha256" in config || "enforceHostKeyPin" in config || "onHostKeySha256" in config ? createSshConfig(config) : config);
  });
}

type PooledSsh = {
  client: Client;
  active: number;
  idleTimer: NodeJS.Timeout | null;
  closed: boolean;
};

const sshPool = new Map<string, Promise<PooledSsh>>();
const sshFailureBackoff = new Map<string, { until: number; message: string }>();

function sshPoolKey(input: SshConnectionParams) {
  return createHash("sha256").update(JSON.stringify({
    host: input.host,
    port: input.port,
    username: input.username,
    privateKey: input.privateKey ?? null,
    passphrase: input.passphrase ?? null,
    password: input.password ?? null,
    hostKeySha256: stripHostKeyFingerprintPrefix(input.hostKeySha256),
    enforceHostKeyPin: input.enforceHostKeyPin ?? getSshEnforceHostKeyPin(),
  })).digest("hex");
}

function shouldPoolSsh(input: SshConnectionParams) {
  return !input.freshConnection && !input.onHostKeySha256 && !input.rejectUnknownHostKeyAfterCapture;
}

async function acquirePooledSsh(input: SshConnectionParams) {
  const key = sshPoolKey(input);
  const backoff = sshFailureBackoff.get(key);
  if (backoff && backoff.until > Date.now()) {
    throw new Error(t("backend.ssh.reconnectPaused", { message: backoff.message }));
  }
  if (backoff) sshFailureBackoff.delete(key);

  let pending = sshPool.get(key);
  if (!pending) {
    pending = connectSsh(createSshConfig(input)).then((client) => {
      const entry: PooledSsh = { client, active: 0, idleTimer: null, closed: false };
      const close = () => {
        entry.closed = true;
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
        if (sshPool.get(key) === pending) sshPool.delete(key);
      };
      client.once("close", close);
      client.once("end", close);
      client.on("error", close);
      sshFailureBackoff.delete(key);
      return entry;
    }).catch((error) => {
      sshPool.delete(key);
      sshFailureBackoff.set(key, {
        until: Date.now() + appConfig.ssh.failureBackoffMs,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
    sshPool.set(key, pending);
  }
  const entry = await pending;
  if (entry.closed) {
    sshPool.delete(key);
    return acquirePooledSsh(input);
  }
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  entry.active += 1;
  return { key, entry };
}

function releasePooledSsh(key: string, entry: PooledSsh) {
  entry.active = Math.max(0, entry.active - 1);
  if (entry.active === 0 && !entry.closed) {
    entry.idleTimer = setTimeout(() => {
      if (entry.active === 0 && sshPool.get(key)) {
        sshPool.delete(key);
        entry.closed = true;
        entry.client.end();
      }
    }, appConfig.ssh.poolIdleTimeoutMs);
    entry.idleTimer.unref?.();
  }
}

export async function closeSshPool() {
  const entries = [...sshPool.values()];
  sshPool.clear();
  sshFailureBackoff.clear();
  await Promise.allSettled(entries.map(async (pending) => {
    const entry = await pending;
    entry.closed = true;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.client.end();
  }));
}

async function withReusableSshClient<T>(
  input: SshConnectionParams,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  if (!shouldPoolSsh(input)) {
    const client = await waitForSshResource(connectSsh(createSshConfig(input)), input.signal, client => { client.end(); });
    try {
      return await operation(client);
    } finally {
      client.end();
    }
  }
  const { key, entry } = await waitForSshResource(acquirePooledSsh(input), input.signal, ({ key, entry }) => releasePooledSsh(key, entry));
  try {
    return await operation(entry.client);
  } finally {
    releasePooledSsh(key, entry);
  }
}

function usesAgentOnly(input: SshConnectionParams) {
  return Boolean(input.agentServerId && !input.privateKey && !input.password);
}

/** A file operation requires a successful Agent result. */
async function execAgentOnly(input: SshConnectionParams, command: string, timeoutMs = 60_000, signal = input.signal) {
  signal?.throwIfAborted();
  if (!input.agentServerId) throw new BusinessError(t("backend.server.agentIdentityMissing"));
  const { executeCommandWithAgent } = await import("@/lib/server/agent-service");
  const result = await executeCommandWithAgent({ serverId: input.agentServerId, command, timeoutMs, signal, expectedIdentity: input.expectedIdentity });
  if (!result) throw new BusinessError(t("backend.server.agentOfflineNoFallback"));
  if (result.exitCode !== 0) {
    throw new BusinessError(result.stderr || result.stdout || t("backend.server.agentCommandFailed", { code: result.exitCode }));
  }
  return result;
}

function pythonCommand(source: string, args: string[]) {
  const encoded = Buffer.from(source).toString("base64");
  return `python3 -c "$(printf %s ${shellQuote(encoded)} | base64 -d)" ${args.map(shellQuote).join(" ")}`;
}

async function withSftpChannel<T>(
  client: Client, operation: (sftp: SFTPWrapper, progress: () => void) => Promise<T>,
  signal?: AbortSignal, timeoutMs?: number,
): Promise<T> {
  let closed = false;
  let channel: SFTPWrapper | undefined;
  try {
    signal?.throwIfAborted();
    const opening = () => sftpRequest<SFTPWrapper>(done => client.sftp((err, sftp) => {
      if (!err && closed) { sftp.end(); return; }
      channel = sftp;
      done(err, sftp);
    }));
    const sftp = await sftpDeadline(opening, signal).catch(error => {
      // A subsystem request that never produced a channel has no independent
      // close handle. Retire its transport so it cannot strand a pool slot.
      if (!channel) client.end();
      throw error;
    });
    return await sftpDeadline(progress => operation(sftp, progress), signal, timeoutMs);
  } finally {
    closed = true;
    channel?.end();
  }
}

async function sftpReaddir(client: Client, remotePath: string, limit: number, signal?: AbortSignal) {
  return withSftpChannel(client, async sftp => {
    const handle = await sftpRequest<Buffer>(done => sftp.opendir(remotePath, done));
    const entries: SftpListEntry[] = [];
    let bytes = 0;
    // Closing the subsystem also releases its directory handle on a timeout.
    for (;;) {
      const batch = await sftpRequest<FileEntryWithStats[]>(done => sftp.readdir(handle, done)).catch(error => {
        if (error?.code === 1) return null; // SSH_FX_EOF
        throw error;
      });
      if (!batch) return { entries, truncated: false };
      for (const { filename: name, longname, attrs } of batch) {
        if (name === "." || name === "..") continue;
        bytes += Buffer.byteLength(name) + Buffer.byteLength(longname) + 96;
        if (entries.length >= limit || bytes > 4 * 1024 * 1024) return { entries, truncated: true };
        entries.push({ name, longname, type: attrs.isDirectory() ? "directory" : attrs.isFile() ? "file" : "other",
          symlink: (attrs.mode & 0o170000) === 0o120000, size: attrs.size, modifyTime: attrs.mtime * 1000, accessTime: attrs.atime * 1000 });
      }
    }
  }, signal);
}

/** Entries an Agent-only listing returns when the caller names no limit (its output has to fit one job result). */
const AGENT_LIST_LIMIT = 10_000;

type DirectoryInput = SshConnectionParams & {
  remotePath: string;
  maxEntries?: number;
  /**
   * The caller acts on what is NOT in the list (sync and stale-entry checks soft-delete the rest), so a list the
   * Agent had to cut short is an error rather than a smaller directory.
   */
  requireComplete?: boolean;
};
export async function listRemoteDirectory(input: DirectoryInput): Promise<SftpListEntry[]> {
  const { entries, truncated } = await listRemoteDirectoryPage(input);
  if (truncated && (input.requireComplete || (!usesAgentOnly(input) && input.maxEntries === undefined))) {
    throw new BusinessError(t("backend.sftp.directoryListingTruncated", { limit: String(input.maxEntries ?? AGENT_LIST_LIMIT) }));
  }
  return entries;
}

export async function listRemoteDirectoryPage(input: DirectoryInput) {
  const limit = Math.min(input.maxEntries ?? AGENT_LIST_LIMIT, AGENT_LIST_LIMIT);
  if (usesAgentOnly(input)) {
    const source = `import itertools,json,os,stat,sys
p=sys.argv[1]; limit=int(sys.argv[2]); out=[]
try:
 with os.scandir(p) as directory: entries=list(itertools.islice(directory,limit+1))
except FileNotFoundError:
 print('null'); sys.exit(0)
for entry in entries[:limit]:
 name=entry.name; s=entry.stat(follow_symlinks=False); mode=s.st_mode
 kind='directory' if stat.S_ISDIR(mode) else ('file' if stat.S_ISREG(mode) else 'other')
 out.append({'name':name,'longname':name,'type':kind,'symlink':stat.S_ISLNK(mode),'size':s.st_size,'modifyTime':int(s.st_mtime*1000),'accessTime':int(s.st_atime*1000)})
print(json.dumps({'total':len(entries),'entries':out},ensure_ascii=False))`;
    const result = await execAgentOnly(input, pythonCommand(source, [input.remotePath, String(limit)]));
    const listing = JSON.parse(result.stdout) as { total: number; entries: SftpListEntry[] } | null;
    if (listing === null) throw Object.assign(new Error("No such directory"), { code: "ENOENT" });
    return { entries: listing.entries, truncated: listing.total > listing.entries.length };
  }
  return withReusableSshClient(input, client => sftpReaddir(client, input.remotePath, limit, input.signal));
}

export async function statRemoteEntry(input: SshConnectionParams & { remotePath: string }): Promise<SftpStatEntry> {
  if (usesAgentOnly(input)) {
    const source = `import json,os,stat,sys
try:
 s=os.lstat(sys.argv[1])
except FileNotFoundError:
 print("null")
else:
 m=s.st_mode
 kind='directory' if stat.S_ISDIR(m) else ('file' if stat.S_ISREG(m) else 'other')
 print(json.dumps({'mode':m,'size':s.st_size,'type':kind,'modifyTime':int(s.st_mtime*1000),'accessTime':int(s.st_atime*1000)}))`;
    const result = await execAgentOnly(input, pythonCommand(source, [input.remotePath]));
    const entry = JSON.parse(result.stdout) as SftpStatEntry | null;
    if (entry === null) throw Object.assign(new Error("No such file"), { code: "ENOENT" });
    return entry;
  }
  return withReusableSshClient(input, async (client) => {
    return withSftpChannel(client, (sftp) => new Promise<SftpStatEntry>((resolve, reject) => {
        sftp.lstat(input.remotePath, (statErr, attrs) => {
          if (statErr) return reject(statErr);
          const mode = attrs.mode ?? 0;
          resolve({
            mode,
            size: attrs.size,
            type: attrs.isDirectory() ? "directory" : attrs.isFile() ? "file" : "other",
            modifyTime: (attrs.mtime ?? 0) * 1000,
            accessTime: (attrs.atime ?? 0) * 1000,
          });
        });
    }), input.signal);
  });
}

export type RemoteTargetType = { type: "file" | "directory" | "other"; size: number } | null;

/**
 * What each path points at, following symbolic links (stat, not lstat); null
 * where it does not resolve, as for a dangling link. One SFTP channel, one
 * path at a time: a channel per path ran into the server's session limit.
 */
export async function statRemoteTargetTypes(input: SshConnectionParams & { remotePaths: string[]; root?: { path: string; windows: boolean } }): Promise<RemoteTargetType[]> {
  if (input.remotePaths.length === 0) return [];
  if (usesAgentOnly(input)) {
    const source = "import json,os,stat,sys\nout=[]\nroot=sys.argv[1]\nfor p in sys.argv[2:]:\n try:\n  p=os.path.realpath(p)\n  if root and os.path.commonpath([root,p])!=root: out.append(None); continue\n  s=os.stat(p)\n except OSError:\n  out.append(None); continue\n m=s.st_mode; out.append({'type':'directory' if stat.S_ISDIR(m) else ('file' if stat.S_ISREG(m) else 'other'),'size':s.st_size})\nprint(json.dumps(out))";
    const result = await execAgentOnly(input, pythonCommand(source, [input.root?.path ?? "", ...input.remotePaths]));
    return JSON.parse(result.stdout) as RemoteTargetType[];
  }
  return withReusableSshClient(input, (client) =>
    withSftpChannel(client, async (sftp) => {
      // SFTP pipelines requests: a directory of hundreds of links used to cost
      // one round trip each, in series (A3-02). Keep a bounded window in flight.
      const out: RemoteTargetType[] = new Array(input.remotePaths.length).fill(null);
      let next = 0;
      const worker = async () => {
        while (next < input.remotePaths.length) {
          const index = next++;
          let target = input.remotePaths[index]!;
          if (input.root) {
            const resolved = await sftpRequest<string>(done => sftp.realpath(target, done)).catch(() => null);
            if (!resolved || !isInsideRoot(resolved, input.root.path, input.root.windows)) continue;
            target = resolved;
          }
          out[index] = await new Promise<RemoteTargetType>((resolve, reject) => {
            sftp.stat(target, (error, attrs) => {
              if (error) {
                // Missing or unreadable target: an unusable link, not a failed listing.
                if ([2, 3].includes((error as { code?: number }).code ?? -1)) return resolve(null);
                return reject(error);
              }
              resolve({ type: attrs.isDirectory() ? "directory" : attrs.isFile() ? "file" : "other", size: attrs.size });
            });
          });
        }
      };
      await Promise.all(Array.from({ length: Math.min(16, input.remotePaths.length) }, worker));
      return out;
    }, input.signal),
  );
}

/**
 * The login account's home directory as the host reports it (A3-10): the
 * restricted file manager used to guess `/home/<user>`, which left accounts
 * with a home under /var/lib, /srv or an LDAP mount without any file access.
 */
export async function resolveRemoteHomeDirectory(input: SshConnectionParams): Promise<string> {
  if (usesAgentOnly(input)) {
    const source = "import os,pwd,sys\nprint(os.path.realpath(pwd.getpwnam(sys.argv[1]).pw_dir))";
    const result = await execAgentOnly(input, pythonCommand(source, [input.username]));
    const resolved = result.stdout.trim();
    if (result.exitCode !== 0 || !/^(\/|[A-Za-z]:[\\/])/.test(resolved)) throw new Error("Unable to resolve remote home directory");
    return resolved;
  }
  return withReusableSshClient(input, (client) =>
    withSftpChannel(client, (sftp) => new Promise<string>((resolve, reject) => {
      sftp.realpath(".", (error, value) => {
        if (error) return reject(error);
        if (!value.startsWith("/")) return reject(new Error("Unable to resolve remote home directory"));
        resolve(value);
      });
    }), input.signal),
  );
}

/**
 * Resolve the canonical (symlink-free) absolute path of `remotePath` on the
 * remote host. For a path that does not yet exist (e.g. an upload/mkdir/rename
 * target), the deepest EXISTING ancestor is resolved via the remote realpath
 * and the remaining not-yet-existing segments are re-appended. This lets a
 * caller enforce a home-directory jail that a symlinked parent could otherwise
 * bypass, while still allowing creation of brand-new paths.
 */
/** A path component is a symbolic link whose target does not exist. */
export class RemoteDanglingLinkError extends Error {
  constructor(readonly remotePath: string) {
    super(`Dangling symbolic link: ${remotePath}`);
    this.name = "RemoteDanglingLinkError";
  }
}

export async function resolveRemoteRealPath(
  input: SshConnectionParams & { remotePath: string },
): Promise<string> {
  const posix = await import("node:path/posix");
  const target = input.remotePath;

  if (usesAgentOnly(input)) {
    // os.path.realpath resolves existing components and leaves the rest intact.
    const source = "import os,sys\nprint(os.path.realpath(sys.argv[1]))";
    const result = await execAgentOnly(input, pythonCommand(source, [target]), 60_000, input.signal);
    const resolved = result.stdout.trim();
    // No answer is not an answer: returning the unresolved input here would
    // let every containment check pass without having looked at the host.
    // An absolute POSIX path, or a drive path should a Windows host answer.
    if (result.exitCode !== 0 || !/^(\/|[A-Za-z]:[\\/])/.test(resolved)) throw new Error("Unable to resolve remote path");
    return resolved;
  }

  return withReusableSshClient(input, (client) =>
    withSftpChannel(client, async (sftp) => {
      const segments = target.split("/").filter(Boolean);
      const trailing: string[] = [];
      for (let i = segments.length; i >= 0; i -= 1) {
        const candidate = "/" + segments.slice(0, i).join("/");
        try {
          const resolved = await new Promise<string>((resolve, reject) => {
            sftp.realpath(candidate, (error, value) => error ? reject(error) : resolve(value));
          });
          return trailing.length > 0 ? posix.join(resolved, ...trailing.reverse()) : resolved;
        } catch (error) {
          // Only a missing path permits walking up. Permission/transport errors
          // cannot establish containment and must reach the access-control caller.
          if ((error as { code?: number }).code !== 2) throw error;
          const isSymlink = await new Promise<boolean>((resolve, reject) => {
            sftp.lstat(candidate, (statError, stats) => {
              if (!statError) return resolve(stats.isSymbolicLink());
              if ((statError as { code?: number }).code === 2) return resolve(false);
              reject(statError);
            });
          });
          // A dangling link is not a missing filename: writing through it can
          // create its target elsewhere, outside the permitted root.
          if (isSymlink) throw new RemoteDanglingLinkError(candidate);
        }
        if (i > 0) trailing.push(segments[i - 1]!);
      }
      throw new Error("Unable to resolve remote path");
    }, input.signal),
  );
}

function sftpMkdir(sftp: SFTPWrapper, remotePath: string, acceptExisting: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (mkdirErr) => {
      if (!mkdirErr) {
        resolve();
        return;
      }
      // SSH_FX_FAILURE (code 4) is a GENERIC failure. Many servers return it for
      // "already exists", but a real fault (e.g. permission, parent missing)
      // also surfaces as 4 — blindly resolving would mask it. Confirm the path
      // is actually an existing directory before treating it as success.
      const sshErr = mkdirErr as { code?: number };
      if (sshErr.code === 4 || sshErr.code === 11) {
        sftp.stat(remotePath, (statErr, stats) => {
          if (!statErr && stats.isDirectory()) {
            if (acceptExisting) resolve();
            else reject(Object.assign(new Error("Directory already exists"), { code: "EEXIST" }));
          } else {
            reject(mkdirErr); // genuine failure → surface the original error
          }
        });
        return;
      }
      reject(mkdirErr);
    });
  });
}

function buildRemoteDirectoryChain(remotePath: string) {
  const normalized = remotePath.replace(/\/+$/, "") || "/";
  if (normalized === "/") return ["/"];

  const segments = normalized.split("/").filter(Boolean);
  const isAbsolute = normalized.startsWith("/");
  const paths: string[] = [];
  let current = isAbsolute ? "" : ".";

  for (const segment of segments) {
    current = current === "" ? `/${segment}` : `${current}/${segment}`;
    paths.push(current);
  }

  return paths;
}

function execCommandOnClient(
  client: Client,
  command: string,
  timeoutMs = 120_000,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  // Cap accumulated output. execRemoteCommand is only used for small control
  // output (pids, statuses, `tail -5`); without a bound a chatty or misbehaving
  // remote command streams unbounded data straight into a growing string and
  // OOMs the Node process. Mirrors the maxBytes guard in readRemoteFile.
  const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    let commandStream: { close?: () => void; destroy?: () => void } | null = null;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      client.off("close", disconnected);
      client.off("end", disconnected);
      client.off("error", fail);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        commandStream?.close?.();
        commandStream?.destroy?.();
      } catch { /* best-effort channel teardown */ }
      reject(error);
    };
    const disconnected = () => fail(new Error("SSH connection closed before command completion"));
    const aborted = () => fail(new DOMException("SSH command cancelled", "AbortError"));
    const timer = setTimeout(() => {
      fail(new Error(`Command timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    client.once("close", disconnected);
    client.once("end", disconnected);
    client.on("error", fail);
    signal?.addEventListener("abort", aborted, { once: true });

    const failOversized = () => {
      fail(new Error(`Command output exceeded ${MAX_OUTPUT_BYTES} bytes; aborted`));
    };

    client.exec(command, (err, stream) => {
      if (err) {
        fail(err);
        return;
      }
      commandStream = stream as unknown as { close?: () => void; destroy?: () => void };
      stream.on("error", fail);
      if (settled) {
        try { commandStream.close?.(); commandStream.destroy?.(); } catch { /* late channel cleanup */ }
        return;
      }
      let stdout = "";
      let stderr = "";
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let bytes = 0;
      stream.on("data", (data: Buffer) => {
        if (settled) return;
        bytes += data.length;
        if (bytes > MAX_OUTPUT_BYTES) return failOversized();
        stdout += stdoutDecoder.write(data);
      });
      stream.stderr.on("data", (data: Buffer) => {
        if (settled) return;
        bytes += data.length;
        if (bytes > MAX_OUTPUT_BYTES) return failOversized();
        stderr += stderrDecoder.write(data);
      });
      stream.on("close", (code: number | null) => {
        if (settled) return;
        if (typeof code !== "number" || !Number.isInteger(code)) {
          fail(new Error("SSH command channel closed without an exit status"));
          return;
        }
        settled = true;
        cleanup();
        resolve({ stdout: stdout + stdoutDecoder.end(), stderr: stderr + stderrDecoder.end(), exitCode: code });
      });
    });
  });
}

export async function createRemoteDirectory(input: SshConnectionParams & { remotePath: string; recursive?: boolean }): Promise<void> {
  if (usesAgentOnly(input)) {
    const source = input.recursive
      ? "import os,sys\nos.makedirs(sys.argv[1],exist_ok=True)"
      : `import os,stat,sys
try:
 os.mkdir(sys.argv[1])
except FileExistsError:
 if not stat.S_ISDIR(os.lstat(sys.argv[1]).st_mode): raise
 print("existing-directory")`;
    const result = await execAgentOnly(input, pythonCommand(source, [input.remotePath]));
    if (result.stdout.trim() === "existing-directory") {
      throw Object.assign(new Error("Directory already exists"), { code: "EEXIST" });
    }
    return;
  }
  await withReusableSshClient(input, async (client) => {
    try {
      await withSftpChannel(client, async (sftp) => {
        const paths = input.recursive ? buildRemoteDirectoryChain(input.remotePath) : [input.remotePath];
        for (const remotePath of paths) {
          await sftpMkdir(sftp, remotePath, input.recursive !== false);
        }
      }, input.signal);
    } catch (sftpError) {
      input.signal?.throwIfAborted();
      if (!input.recursive) throw sftpError;
      const result = await execCommandOnClient(
        client,
        `mkdir -p -- ${shellQuote(input.remotePath)}`,
        30_000,
      );
      if (result.exitCode && result.exitCode !== 0) {
        throw new BusinessError(
          result.stderr ||
            result.stdout ||
            (sftpError instanceof Error
              ? sftpError.message
              : "Remote directory creation failed"),
        );
      }
    }
  });
}

/**
 * Recursively delete a remote directory tree over one SFTP channel: depth-first
 * unlink files / rmdir subdirs, then rmdir the root. Matches the LOCAL driver's
 * `rm(recursive:true)` so a directory delete removes its contents instead of
 * leaving them orphaned on disk after the index was already soft-deleted.
 */
function sftpRemoveRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    sftp.readdir(remotePath, async (readErr, entries) => {
      if (readErr) {
        // Not a readable directory (or already gone) — try a plain rmdir.
        sftp.rmdir(remotePath, (rmdirErr) => (rmdirErr ? reject(rmdirErr) : resolve()));
        return;
      }
      try {
        for (const entry of entries) {
          if (entry.filename === "." || entry.filename === "..") continue;
          const childPath = `${remotePath.replace(/\/+$/, "")}/${entry.filename}`;
          const attrs = entry.attrs;
          const isDir = (attrs.mode! & 0o170000) === 0o040000;
          if (isDir) {
            await sftpRemoveRecursive(sftp, childPath);
          } else {
            await new Promise<void>((res, rej) =>
              sftp.unlink(childPath, (e) => (e ? rej(e) : res())),
            );
          }
        }
        sftp.rmdir(remotePath, (rmdirErr) => (rmdirErr ? reject(rmdirErr) : resolve()));
      } catch (walkError) {
        reject(walkError);
      }
    });
  });
}

export async function deleteRemoteFile(input: SshConnectionParams & { remotePath: string; isDirectory?: boolean; emptyOnly?: boolean }): Promise<void> {
  if (usesAgentOnly(input)) {
    const remove = input.isDirectory ? (input.emptyOnly ? "os.rmdir" : "shutil.rmtree") : "os.unlink";
    const source = `import errno,os,shutil,sys
p=sys.argv[1]
try:
 ${remove}(p)
except FileNotFoundError:
 if os.path.lexists(p): raise
 print("missing")
except OSError as e:
 if e.errno not in (errno.EEXIST, errno.ENOTEMPTY): raise
 print("not-empty")`;
    const result = await execAgentOnly(input, pythonCommand(source, [input.remotePath]));
    if (result.stdout.trim() === "not-empty") throw Object.assign(new Error("Directory not empty"), { code: "ENOTEMPTY" });
    if (result.stdout.trim() === "missing") throw Object.assign(new Error("No such file"), { code: "ENOENT" });
    return;
  }
  await withReusableSshClient(input, async (client) => {
    await withSftpChannel(client, (sftp) => new Promise<void>((resolve, reject) => {
        if (input.isDirectory && input.emptyOnly) {
          sftp.rmdir(input.remotePath, (err) => {
            if (!err) return resolve();
            // SFTP v3 often reports a generic FAILURE for a nonempty directory.
            if ((err as { code?: number }).code !== 4) return reject(err);
            sftp.readdir(input.remotePath, (readErr, rows) => {
              if (readErr || !rows.some(row => row.filename !== "." && row.filename !== "..")) return reject(err);
              reject(Object.assign(new Error("Directory not empty"), { code: "ENOTEMPTY" }));
            });
          });
        } else if (input.isDirectory) {
          // Recursively remove the whole tree (contents + directory) so the
          // physical delete matches the recursive index soft-delete. Previously
          // a non-empty directory was rejected, leaving files orphaned on disk
          // while the UI showed them as deleted.
          sftpRemoveRecursive(sftp, input.remotePath).then(resolve, reject);
        } else {
          sftp.unlink(input.remotePath, (unlinkErr) => {
            if (unlinkErr) reject(unlinkErr);
            else resolve();
          });
        }
    }), input.signal);
  });
}

export async function renameRemoteFile(input: SshConnectionParams & { oldPath: string; newPath: string; noReplace?: boolean }): Promise<void> {
  if (usesAgentOnly(input)) {
    const source = input.noReplace ? NO_REPLACE_RENAME_PYTHON : "import os,sys\nos.rename(sys.argv[1],sys.argv[2])";
    await execAgentOnly(input, pythonCommand(source, [input.oldPath, input.newPath]));
    return;
  }
  await withReusableSshClient(input, async (client) => {
    await withSftpChannel(client, (sftp) => new Promise<void>((resolve, reject) => {
        sftp.rename(input.oldPath, input.newPath, (renameErr) => {
          if (renameErr) reject(renameErr);
          else resolve();
        });
    }), input.signal);
  });
}

// Six million binary bytes fit in the Agent's 8 MiB stdout budget after base64 encoding.
export const AGENT_FILE_MAX_BYTES = 6_000_000;

export async function readRemoteFile(
  input: SshConnectionParams & { remotePath: string; maxBytes?: number },
): Promise<Buffer> {
  if (usesAgentOnly(input)) {
    const sizeResult = await execAgentOnly(
      input,
      pythonCommand("import os,sys\nprint(os.path.getsize(sys.argv[1]))", [input.remotePath]),
    );
    const sizeText = sizeResult.stdout.trim();
    const size = Number(sizeText);
    if (!/^\d+$/.test(sizeText) || !Number.isSafeInteger(size)) {
      throw new BusinessError(t("backend.server.agentFileSizeUnknown"));
    }
    if (size > AGENT_FILE_MAX_BYTES) throw new BusinessError(t("backend.server.agentReadLimit"));
    if (input.maxBytes !== undefined && size > input.maxBytes) throw new BusinessError(t("backend.storage.remoteReadTooLarge"));
    // Bound the second read even when the file grows after the stat. One extra
    // byte distinguishes a complete file from a prefix of a larger file.
    const source = "import base64,sys\nwith open(sys.argv[1],'rb') as f: data=f.read(int(sys.argv[2]))\nprint(base64.b64encode(data).decode())";
    const result = await execAgentOnly(input, pythonCommand(source, [input.remotePath, String(size + 1)]));
    const encoded = result.stdout.trim();
    const content = Buffer.from(encoded, "base64");
    if (content.length !== size || encoded.length !== 4 * Math.ceil(size / 3)) {
      throw new BusinessError(t("backend.server.agentFileSizeChanged"));
    }
    return content;
  }
  return withReusableSshClient(input, async (client) => {
    return withSftpChannel(client, (sftp, progress) => new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let received = 0;
        const readStream = sftp.createReadStream(input.remotePath);
        readStream.on("data", (chunk: Buffer | string) => {
          progress();
          const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          received += buf.length;
          // Enforce the cap while streaming so an unindexed multi-GB file can
          // never be buffered whole into memory (OOM). Destroy the stream and
          // reject as soon as we cross the limit instead of reading to EOF.
          if (input.maxBytes !== undefined && received > input.maxBytes) {
            try { readStream.destroy(); } catch { /* best-effort */ }
            reject(new BusinessError(t("backend.storage.remoteReadTooLarge")));
            return;
          }
          chunks.push(buf);
        });
        readStream.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
        readStream.on("error", reject);
    }), input.signal, SFTP_TRANSFER_IDLE_TIMEOUT_MS);
  });
}

/**
 * Base64 characters per Agent write command (a multiple of 4, so each chunk
 * decodes alone). The Agent runs a job as `sh -c <command>`: one argument,
 * which Linux caps at 128 KiB (MAX_ARG_STRLEN). A file sent in one command
 * failed to start beyond about 96 KB — and the Agent never reported that job,
 * so the write hung until its timeout.
 */
const AGENT_WRITE_CHUNK = 64 * 1024;

export async function writeRemoteFile(input: SshConnectionParams & { remotePath: string; content: string | Buffer; root?: { path: string; windows: boolean } }): Promise<void> {
  if (usesAgentOnly(input)) {
    if (Buffer.byteLength(input.content) > AGENT_FILE_MAX_BYTES) throw new BusinessError(t("backend.server.agentWriteLimit"));
    const encoded = Buffer.from(input.content).toString("base64");
    // Agent jobs run in separate processes. Re-open the parent without following
    // links on every chunk, and match both inode identities before writing.
    const openParent = `import base64,json,os,stat,sys
def parent_dir(dst):
 fd=os.open('/',os.O_DIRECTORY)
 for part in os.path.dirname(dst).strip('/').split('/'):
  if not part: continue
  child=os.open(part,os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
  os.close(fd)
  fd=child
 return fd
def identity(fd):
 st=os.fstat(fd)
 return [str(st.st_dev),str(st.st_ino)]
`;
    const created = await execAgentOnly(input, pythonCommand(openParent + `
dst=os.path.realpath(sys.argv[1])
root=sys.argv[3]
if root and (dst!=os.path.normpath(sys.argv[1]) or os.path.commonpath([dst,root])!=root): raise PermissionError("Outside the authorized directory")
parent=parent_dir(dst)
name=sys.argv[4]
os.mkdir(name,0o700,dir_fd=parent)
stage=os.open(name,os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
if os.fstat(stage).st_uid!=os.geteuid() or os.fstat(stage).st_mode & 0o077: raise PermissionError("Stage changed")
try:
 fd=os.open('content',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=stage)
 with os.fdopen(fd,'wb') as f:
  binding=[dst,name,identity(parent),identity(stage),identity(fd)]
  f.write(base64.b64decode(sys.argv[2]))
except:
 if 'fd' in locals(): os.unlink('content',dir_fd=stage)
 os.rmdir(name,dir_fd=parent)
 raise
print(json.dumps(binding))`, [input.remotePath, encoded.slice(0, AGENT_WRITE_CHUNK), input.root?.path ?? "", uploadStageName()]));
    const binding = created.stdout.trim();
    const reopen = openParent + `
dst,name,parentId,stageId,fileId=json.loads(sys.argv[1])
parent=parent_dir(dst)
if identity(parent)!=parentId: raise PermissionError("Parent changed")
stage=os.open(name,os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
if identity(stage)!=stageId: raise PermissionError("Stage changed")
fd=os.open('content',os.O_NOFOLLOW|os.O_WRONLY|os.O_APPEND|os.O_NONBLOCK,dir_fd=stage)
if identity(fd)!=fileId or os.fstat(fd).st_nlink!=1: raise PermissionError("Stage changed")
`;
    try {
      for (let offset = AGENT_WRITE_CHUNK; offset < encoded.length; offset += AGENT_WRITE_CHUNK) {
        await execAgentOnly(input, pythonCommand(reopen + "with os.fdopen(fd,'ab') as f: f.write(base64.b64decode(sys.argv[2]))", [binding, encoded.slice(offset, offset + AGENT_WRITE_CHUNK)]));
      }
      await execAgentOnly(input, pythonCommand(reopen + `
target=os.path.basename(dst)
try: st=os.stat(target,dir_fd=parent,follow_symlinks=False)
except FileNotFoundError: st=None
if st:
 if not stat.S_ISREG(st.st_mode): raise ValueError("Expected regular file")
 fileStat=os.fstat(fd)
 if (fileStat.st_uid,fileStat.st_gid)!=(st.st_uid,st.st_gid): os.fchown(fd,st.st_uid,st.st_gid)
 os.fchmod(fd,st.st_mode & 0o777)
else:
 mask=os.umask(0o077)
 os.fchmod(fd,0o666 & ~mask)
os.replace('content',target,src_dir_fd=stage,dst_dir_fd=parent)
try: os.rmdir(name,dir_fd=parent)
except OSError: pass`, [binding]));
    } catch (error) {
      await execAgentOnly(input, pythonCommand(reopen + "os.unlink('content',dir_fd=stage)\nos.rmdir(name,dir_fd=parent)", [binding])).catch(() => undefined);
      throw error;
    }
    return;
  }
  await withReusableSshClient(input, async (client) => {
    await withSftpChannel(client, (sftp, progress) => atomicSftpWrite(sftp, input.remotePath, stream => new Promise<void>((resolve, reject) => {
      const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content);
      let offset = 0;
      stream.once("close", resolve);
      stream.once("error", reject);
      const next = (error?: Error | null) => {
        if (error) { reject(error); return; }
        if (stream.destroyed) return;
        progress();
        if (offset === content.length) { stream.end(); return; }
        const chunk = content.subarray(offset, offset + 64 * 1024);
        offset += chunk.length;
        stream.write(chunk, next);
      };
      next();
    }), input.root, 0o666, input.signal), input.signal, SFTP_TRANSFER_IDLE_TIMEOUT_MS);
  });
}

/** Execute a command on a remote server via SSH and return stdout/stderr/exit code */
function waitForSshResource<T>(resource: Promise<T>, signal: AbortSignal | undefined, release: (value: T) => void): Promise<T> {
  if (!signal) return resource;
  return new Promise((resolve, reject) => {
    let cancelled = false;
    const abort = () => { cancelled = true; reject(new DOMException("SSH connection wait cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    resource.then((value) => {
      signal.removeEventListener("abort", abort);
      if (cancelled) release(value);
      else resolve(value);
    }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

async function assertCurrentCommandEndpoint(input: SshConnectionParams) {
  if (!input.expectedIdentity) return;
  const { prisma } = await import("@/lib/db");
  const current = await prisma.server.findUnique({
    where: {
      id: input.expectedIdentity.serverId, teamId: input.expectedIdentity.teamId, enabled: true,
      team: { isNot: { deletedAt: { not: null } } },
      host: input.host, port: input.port, username: input.username, hostKeySha256: input.hostKeySha256,
      managementMode: input.agentServerId ? "AGENT" : "DIRECT",
      ...(input.agentServerId && { agentTokenHash: input.expectedIdentity.tokenHash }),
    },
    select: { id: true },
  });
  if (!current) throw new BusinessError(t("backend.command.connectionChanged"));
}

type RemoteCommandInput = SshConnectionParams & { command: string; timeout?: number; signal?: AbortSignal; preferAgent?: boolean };

export async function execRemoteCommand(input: RemoteCommandInput): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
 input.signal?.throwIfAborted();
 const tryAgent = Boolean(input.agentServerId && (input.preferAgent || usesAgentOnly(input)));
 if (input.agentServerId && tryAgent) {
   const { executeCommandWithAgent } = await import("@/lib/server/agent-service");
   const result = await executeCommandWithAgent({
     serverId: input.agentServerId, expectedIdentity: input.expectedIdentity, command: input.command, timeoutMs: input.timeout ?? 120_000, signal: input.signal,
   });
   input.signal?.throwIfAborted();
   if (result) return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
   // Only null proves the Agent never took this job. A nonzero result or a lost
   // acknowledgement must never execute the operation a second time over SSH.
   if (usesAgentOnly(input)) throw new BusinessError(t("backend.server.agentOfflineNoFallback"));
 }
 // The Agent enqueue transaction already fences transfers. Direct SSH has no
 // job row: take the transfer lock for this command (including SSH fallback)
 // so its last ownership check remains valid until the remote command ends.
 if (!input.expectedIdentity) return executeSshCommand(input, tryAgent);
 const { withServerLifecycleLock } = await import("@/lib/server/lifecycle-lock");
 return withServerLifecycleLock(input.expectedIdentity.serverId, () => {
   input.signal?.throwIfAborted();
   return executeSshCommand(input, tryAgent);
 });
}

async function executeSshCommand(input: RemoteCommandInput, agentFallback: boolean) {
 if (agentFallback && input.agentServerId) {
   if (!input.hostKeySha256) throw new BusinessError(t("backend.ssh.hostKeyNotPinned"));
   // The node could have changed while its Agent job was pending. Verify the
   // saved endpoint and credential again before opening a fallback connection.
   const { prisma } = await import("@/lib/db");
   const { SSH_CONNECTION_SERVER_SELECT } = await import("./server-connection-select");
   const current = await prisma.server.findUnique({
     where: { id: input.agentServerId, enabled: true, managementMode: "AGENT", host: input.host,
       port: input.port, username: input.username, hostKeySha256: input.hostKeySha256,
       ...(input.expectedIdentity && { teamId: input.expectedIdentity.teamId, agentTokenHash: input.expectedIdentity.tokenHash }) },
     select: SSH_CONNECTION_SERVER_SELECT,
   });
   if (!current) throw new BusinessError(t("backend.command.connectionChanged"));
   const login = await buildSshParamsFromServer(current, current.sshKey, current.teamId);
   if (login.password !== input.password || login.privateKey !== input.privateKey || login.passphrase !== input.passphrase) {
     throw new BusinessError(t("backend.command.connectionChanged"));
   }
 } else {
   await assertCurrentCommandEndpoint(input);
 }
 if (!shouldPoolSsh(input)) {
   const client = await waitForSshResource(connectSsh(createSshConfig(input)), input.signal, (client) => { client.end(); });
   try {
     await assertCurrentCommandEndpoint(input);
     return await execCommandOnClient(client, input.command, input.timeout ?? 120_000, input.signal);
   } finally {
     client.end();
   }
 }
 const { key, entry } = await waitForSshResource(acquirePooledSsh(input), input.signal, ({ key, entry }) => releasePooledSsh(key, entry));
 try {
   await assertCurrentCommandEndpoint(input);
   return await execCommandOnClient(entry.client, input.command, input.timeout ?? 120_000, input.signal);
 } finally {
   releasePooledSsh(key, entry);
 }
}

/** Build SSH connection params from a Server + SshKey record */
export async function buildSshParamsFromServer(server: {
  /**
   * Every field below is required on purpose: a projection that left one out
   * still compiled and silently took another path — without operatingSystem a
   * Windows node was treated as Linux, without connectionType a key-based
   * server fell into the password branch with no password, without
   * managementMode/id an Agent-managed server was dialled over SSH, and
   * without hostKeySha256 the saved pin was not checked.
   */
  teamId?: string | null;
  agentTokenHash?: string | null;
  operatingSystem: string;
  host: string;
  port: number;
  username: string;
  connectionType: string;
  sshKeyId: string | null;
  password: string | null;
  hostKeySha256: string | null;
  id: string;
  managementMode: string;
}, sshKey?: StoredSshKey | null, expectedTeamId?: string | null): Promise<SshConnectionParams> {
  if (server.operatingSystem === "WINDOWS") throw new BusinessError(t("backend.server.linuxOnly"));
  if (expectedTeamId !== undefined && server.teamId !== expectedTeamId) throw new BusinessError(t("backend.command.connectionChanged"));
  const base = {
    enforceHostKeyPin: true,
    ...(expectedTeamId !== undefined && { expectedIdentity: { serverId: server.id, teamId: expectedTeamId, tokenHash: server.agentTokenHash ?? null, endpoint: { host: server.host, port: server.port, username: server.username, hostKeySha256: server.hostKeySha256 } } }),
    host: server.host,
    port: server.port,
    username: server.username,
    hostKeySha256: server.hostKeySha256 ?? null,
    ...(server.managementMode === "AGENT" && server.id ? { agentServerId: server.id } : {}),
  };
  // Legacy/internal projections may omit connectionType; infer from the bound
  // key id only for compatibility. Persisted Server rows always provide it.
  const connectionType = server.connectionType ?? (server.sshKeyId ? "SSH_KEY" : "PASSWORD");
  if (connectionType === "SSH_KEY") {
    return { ...base, ...decryptStoredSshKey(sshKey, server.teamId) };
  }
  if (connectionType === "PASSWORD") {
    return {
      ...base,
      ...(server.password ? { password: decryptServerPassword(server.password) } : {}),
    };
  }
  throw new BusinessError(t("backend.server.unsupportedSshConnectionType", { connectionType }));
}
