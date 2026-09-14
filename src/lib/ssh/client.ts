import { Client, type ConnectConfig } from "ssh2";
import type { SFTPWrapper } from "ssh2";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { BusinessError } from "@/lib/errors";
import { config as appConfig } from "@/lib/config/env";
import { shellQuote } from "@/lib/shell-quote";
import { t } from "@/lib/i18n/service-translations";

import { decryptServerPassword, decryptSshPrivateKey, decryptSshKeyPassphrase } from "@/lib/ssh/ssh-key-crypto";

export type SshConnectionParams = {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  passphrase?: string;
  password?: string;
  hostKeySha256?: string | null;
  /** Capture the remote SHA256 host key hash during TOFU discovery. */
  onHostKeySha256?: (fingerprint: string) => void;
  /** Abort immediately after host-key capture so first-contact TOFU never sends credentials. */
  rejectUnknownHostKeyAfterCapture?: boolean;
  /** OPEN-1: When true, reject connection if hostKeySha256 is not pinned.
   *  The fingerprint is still captured via onHostKeySha256 before rejection. */
  enforceHostKeyPin?: boolean;
  /** Agent transport fallback used when no SSH credential is stored. */
  agentServerId?: string;
};

export type SftpListEntry = {
 name: string;
 longname: string;
 type: "file" | "directory" | "other";
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

function normalizeHostKeySha256(fingerprint?: string | null): string | null {
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
 const config: ConnectConfig = {
  host: input.host,
  port: input.port,
  username: input.username,
  readyTimeout: 15000,
  timeout: 10000,
 };

 if (input.privateKey) {
   config.privateKey = input.privateKey;
   if (input.passphrase) config.passphrase = input.passphrase;
 } else if (input.password) {
  config.password = input.password;
 }

 const expectedHostKey = normalizeHostKeySha256(input.hostKeySha256);
 const enforceHostKeyPin = input.enforceHostKeyPin ?? appConfig.ssh.enforceHostKeyPin;
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
    client.on("ready", () => resolve(client));
    client.on("error", (err) => reject(err));
    client.connect("hostKeySha256" in config ? createSshConfig(config) : config);
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
    hostKeySha256: normalizeHostKeySha256(input.hostKeySha256),
    enforceHostKeyPin: input.enforceHostKeyPin ?? appConfig.ssh.enforceHostKeyPin,
  })).digest("hex");
}

function shouldPoolSsh(input: SshConnectionParams) {
  return !input.onHostKeySha256 && !input.rejectUnknownHostKeyAfterCapture;
}

async function acquirePooledSsh(input: SshConnectionParams) {
  const key = sshPoolKey(input);
  const backoff = sshFailureBackoff.get(key);
  if (backoff && backoff.until > Date.now()) {
    throw new Error(`SSH reconnect temporarily paused after a connection failure: ${backoff.message}`);
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
    const client = await connectSsh(createSshConfig(input));
    try {
      return await operation(client);
    } finally {
      client.end();
    }
  }
  const { key, entry } = await acquirePooledSsh(input);
  try {
    return await operation(entry.client);
  } finally {
    releasePooledSsh(key, entry);
  }
}

function usesAgentOnly(input: SshConnectionParams) {
  return Boolean(input.agentServerId && !input.privateKey && !input.password);
}

async function execAgentOnly(input: SshConnectionParams, command: string, timeoutMs = 60_000, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!input.agentServerId) throw new BusinessError(t("backend.server.agentIdentityMissing"));
  const { executeCommandWithAgent } = await import("@/lib/server/agent-service");
  const result = await executeCommandWithAgent({ serverId: input.agentServerId, command, timeoutMs, signal });
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

async function withSftpChannel<T>(client: Client, operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((error, channel) => {
      if (error) reject(error);
      else resolve(channel);
    });
  });
  try {
    return await operation(sftp);
  } finally {
    try { sftp.end(); } catch { /* best-effort channel cleanup */ }
  }
}

function sftpReaddir(client: Client, remotePath: string): Promise<SftpListEntry[]> {
  return withSftpChannel(client, (sftp) => new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err2, entries) => {
        if (err2) return reject(err2);
        const result: SftpListEntry[] = entries.map((entry) => {
          const attrs = entry.attrs;
          const isDir = (attrs.mode! & 0o170000) === 0o040000;
          return {
            name: entry.filename,
            longname: entry.longname,
            type: isDir ? "directory" : attrs.isFile() ? "file" : "other",
            size: attrs.size,
            modifyTime: (attrs.mtime ?? 0) * 1000,
            accessTime: (attrs.atime ?? 0) * 1000,
          };
        });
        resolve(result);
      });
  }));
}

export async function listRemoteDirectory(input: SshConnectionParams & { remotePath: string; maxEntries?: number }): Promise<SftpListEntry[]> {
  if (usesAgentOnly(input)) {
    const source = "import json,os,stat,sys\np=sys.argv[1]; limit=int(sys.argv[2]); out=[]\nfor name in os.listdir(p)[:limit]:\n q=os.path.join(p,name); s=os.lstat(q); mode=s.st_mode; kind='directory' if stat.S_ISDIR(mode) else ('file' if stat.S_ISREG(mode) else 'other'); out.append({'name':name,'longname':name,'type':kind,'size':s.st_size,'modifyTime':int(s.st_mtime*1000),'accessTime':int(s.st_atime*1000)})\nprint(json.dumps(out,ensure_ascii=False))";
    const result = await execAgentOnly(input, pythonCommand(source, [input.remotePath, String(input.maxEntries ?? 10_000)]));
    return JSON.parse(result.stdout) as SftpListEntry[];
  }
  return withReusableSshClient(input, async (client) => {
    const entries = await sftpReaddir(client, input.remotePath);
    // 过滤掉 . 和 ..
    const visible = entries.filter((e) => e.name !== "." && e.name !== "..");
    return input.maxEntries ? visible.slice(0, input.maxEntries) : visible;
  });
}

export async function statRemoteEntry(input: SshConnectionParams & { remotePath: string }): Promise<SftpStatEntry> {
  if (usesAgentOnly(input)) {
    const source = "import json,os,stat,sys\ns=os.lstat(sys.argv[1]); m=s.st_mode; kind='directory' if stat.S_ISDIR(m) else ('file' if stat.S_ISREG(m) else 'other'); print(json.dumps({'mode':m,'size':s.st_size,'type':kind,'modifyTime':int(s.st_mtime*1000),'accessTime':int(s.st_atime*1000)}))";
    const result = await execAgentOnly(input, pythonCommand(source, [input.remotePath]));
    return JSON.parse(result.stdout) as SftpStatEntry;
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
    }));
  });
}

/**
 * Resolve the canonical (symlink-free) absolute path of `remotePath` on the
 * remote host. For a path that does not yet exist (e.g. an upload/mkdir/rename
 * target), the deepest EXISTING ancestor is resolved via the remote realpath
 * and the remaining not-yet-existing segments are re-appended. This lets a
 * caller enforce a home-directory jail that a symlinked parent could otherwise
 * bypass, while still allowing creation of brand-new paths.
 */
export async function resolveRemoteRealPath(
  input: SshConnectionParams & { remotePath: string },
): Promise<string> {
  const posix = await import("node:path/posix");
  const target = input.remotePath;

  if (usesAgentOnly(input)) {
    // os.path.realpath resolves existing components and leaves the rest intact.
    const source = "import os,sys\nprint(os.path.realpath(sys.argv[1]))";
    const result = await execAgentOnly(input, pythonCommand(source, [target]));
    return result.stdout.trim() || target;
  }

  return withReusableSshClient(input, async (client) =>
    withSftpChannel(client, (sftp) => new Promise<string>((resolve) => {
      const realpathOf = (p: string) =>
        new Promise<string | null>((res) => {
          sftp.realpath(p, (err, resolved) => res(err ? null : resolved));
        });

      // Walk from the full path upward to the deepest ancestor that resolves.
      (async () => {
        const segments = target.split("/").filter(Boolean);
        const trailing: string[] = [];
        for (let i = segments.length; i >= 0; i -= 1) {
          const candidate = "/" + segments.slice(0, i).join("/");
          const resolved = await realpathOf(candidate === "/" ? "/" : candidate);
          if (resolved !== null) {
            resolve(
              trailing.length > 0
                ? posix.join(resolved, ...trailing.reverse())
                : resolved,
            );
            return;
          }
          if (i > 0) trailing.push(segments[i - 1]!);
        }
        // Nothing resolved (unusual) — fall back to the lexical path.
        resolve(target);
      })();
    })),
  );
}

function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
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
      if (sshErr.code === 4) {
        sftp.stat(remotePath, (statErr, stats) => {
          if (!statErr && stats.isDirectory()) {
            resolve(); // already-exists → idempotent success
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
      : "import os,sys\nos.mkdir(sys.argv[1])";
    await execAgentOnly(input, pythonCommand(source, [input.remotePath]));
    return;
  }
  await withReusableSshClient(input, async (client) => {
    try {
      await withSftpChannel(client, (sftp) => new Promise<void>((resolve, reject) => {
          const paths = input.recursive ? buildRemoteDirectoryChain(input.remotePath) : [input.remotePath];
          paths
            .reduce<Promise<void>>((promise, remotePath) => promise.then(() => sftpMkdir(sftp, remotePath)), Promise.resolve())
            .then(resolve, reject);
      }));
    } catch (sftpError) {
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

export async function deleteRemoteFile(input: SshConnectionParams & { remotePath: string; isDirectory?: boolean }): Promise<void> {
  if (usesAgentOnly(input)) {
    // shutil.rmtree gives the agent path the same recursive semantics as SFTP.
    const source = input.isDirectory
      ? "import shutil,sys\nshutil.rmtree(sys.argv[1])"
      : "import os,sys\nos.unlink(sys.argv[1])";
    await execAgentOnly(input, pythonCommand(source, [input.remotePath]));
    return;
  }
  await withReusableSshClient(input, async (client) => {
    await withSftpChannel(client, (sftp) => new Promise<void>((resolve, reject) => {
        if (input.isDirectory) {
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
    }));
  });
}

export async function renameRemoteFile(input: SshConnectionParams & { oldPath: string; newPath: string }): Promise<void> {
  if (usesAgentOnly(input)) {
    await execAgentOnly(input, pythonCommand("import os,sys\nos.rename(sys.argv[1],sys.argv[2])", [input.oldPath, input.newPath]));
    return;
  }
  await withReusableSshClient(input, async (client) => {
    await withSftpChannel(client, (sftp) => new Promise<void>((resolve, reject) => {
        sftp.rename(input.oldPath, input.newPath, (renameErr) => {
          if (renameErr) reject(renameErr);
          else resolve();
        });
    }));
  });
}

export async function readRemoteFile(
  input: SshConnectionParams & { remotePath: string; maxBytes?: number },
): Promise<Buffer> {
  // Agent-only path keeps its own 5MB ceiling; honour a smaller caller cap too.
  const agentCap = Math.min(input.maxBytes ?? 5 * 1_048_576, 5 * 1_048_576);
  if (usesAgentOnly(input)) {
    const sizeResult = await execAgentOnly(
      input,
      pythonCommand("import os,sys\nprint(os.path.getsize(sys.argv[1]))", [input.remotePath]),
    );
    const size = Number.parseInt(sizeResult.stdout.trim(), 10);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new BusinessError(t("backend.server.agentFileSizeUnknown"));
    }
    if (size > agentCap) {
      throw new BusinessError(t("backend.server.agentReadLimit"));
    }
    const result = await execAgentOnly(input, pythonCommand("import base64,sys\nprint(base64.b64encode(open(sys.argv[1],'rb').read()).decode())", [input.remotePath]));
    return Buffer.from(result.stdout.trim(), "base64");
  }
  return withReusableSshClient(input, async (client) => {
    return withSftpChannel(client, (sftp) => new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let received = 0;
        const readStream = sftp.createReadStream(input.remotePath);
        readStream.on("data", (chunk: Buffer | string) => {
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
readStream.on("error", (readErr: Error) => {
				reject(readErr);
        });
    }));
  });
}

export async function writeRemoteFile(input: SshConnectionParams & { remotePath: string; content: string | Buffer }): Promise<void> {
  if (usesAgentOnly(input)) {
    const encoded = Buffer.from(input.content).toString("base64");
    if (encoded.length > 8_000_000) throw new BusinessError(t("backend.server.agentWriteLimit"));
    await execAgentOnly(input, pythonCommand("import base64,sys\nopen(sys.argv[1],'wb').write(base64.b64decode(sys.argv[2]))", [input.remotePath, encoded]));
    return;
  }
  await withReusableSshClient(input, async (client) => {
    await withSftpChannel(client, (sftp) => new Promise<void>((resolve, reject) => {
        const writeStream = sftp.createWriteStream(input.remotePath);
        writeStream.on("close", () => resolve());
        writeStream.on("error", (writeErr: Error) => reject(writeErr));
        writeStream.end(input.content);
    }));
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

export async function execRemoteCommand(
 input: SshConnectionParams & { command: string; timeout?: number; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
 input.signal?.throwIfAborted();
 if (usesAgentOnly(input)) {
   return execAgentOnly(input, input.command, input.timeout ?? 120_000, input.signal);
 }
 if (!shouldPoolSsh(input)) {
   const client = await waitForSshResource(connectSsh(createSshConfig(input)), input.signal, (client) => { client.end(); });
   try {
     return await execCommandOnClient(client, input.command, input.timeout ?? 120_000, input.signal);
   } finally {
     client.end();
   }
 }
 const { key, entry } = await waitForSshResource(acquirePooledSsh(input), input.signal, ({ key, entry }) => releasePooledSsh(key, entry));
 try {
   return await execCommandOnClient(entry.client, input.command, input.timeout ?? 120_000, input.signal);
 } finally {
   releasePooledSsh(key, entry);
 }
}

/** Build SSH connection params from a Server + SshKey record */
export async function buildSshParamsFromServer(server: {
 host: string;
 port: number;
 username: string;
 connectionType?: string;
 sshKeyId: string | null;
 password: string | null;
  hostKeySha256?: string | null;
  id?: string;
  managementMode?: string;
}, sshKey?: { privateKey: string | null; passphrase?: string | null } | null): Promise<SshConnectionParams> {
  const base = {
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
    return {
      ...base,
      ...(sshKey?.privateKey ? {
      privateKey: decryptSshPrivateKey(sshKey.privateKey),
      ...(sshKey.passphrase ? { passphrase: decryptSshKeyPassphrase(sshKey.passphrase) } : {}),
      } : {}),
    };
  }
  if (connectionType === "PASSWORD") {
    return {
      ...base,
      ...(server.password ? { password: decryptServerPassword(server.password) } : {}),
    };
  }
  throw new BusinessError(t("backend.server.unsupportedSshConnectionType", { connectionType }));
}
