import { Client, type ConnectConfig } from "ssh2";
import { decryptServerPassword, decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";

export type SshConnectionParams = {
 host: string;
 port: number;
 username: string;
 privateKey?: string;
 password?: string;
};

export type SftpListEntry = {
 name: string;
 longname: string;
 type: "file" | "directory" | "other";
 size: number;
 modifyTime: number;
 accessTime: number;
};

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
 } else if (input.password) {
  config.password = input.password;
 }

 return config;
}

function connectSsh(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on("ready", () => resolve(client));
    client.on("error", (err) => reject(err));
    client.connect(config);
  });
}

function sftpReaddir(client: Client, remotePath: string): Promise<SftpListEntry[]> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
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
    });
  });
}

export async function listRemoteDirectory(input: SshConnectionParams & { remotePath: string }): Promise<SftpListEntry[]> {
  const config = createSshConfig(input);
  const client = await connectSsh(config);
  try {
    const entries = await sftpReaddir(client, input.remotePath);
    // 过滤掉 . 和 ..
    return entries.filter((e) => e.name !== "." && e.name !== "..");
  } finally {
    client.end();
  }
}

export async function createRemoteDirectory(input: SshConnectionParams & { remotePath: string }): Promise<void> {
  const config = createSshConfig(input);
  const client = await connectSsh(config);
  try {
    await new Promise<void>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        sftp.mkdir(input.remotePath, (mkdirErr) => {
          // SSH_FX_FAILURE (code 4) is returned when directory already exists — ignore
          if (mkdirErr) {
            const sshErr = mkdirErr as { code?: number };
            if (sshErr.code === 4) {
              resolve();
            } else {
              reject(mkdirErr);
            }
          } else {
            resolve();
          }
        });
      });
    });
  } finally {
    client.end();
  }
}

export async function deleteRemoteFile(input: SshConnectionParams & { remotePath: string; isDirectory?: boolean }): Promise<void> {
  const config = createSshConfig(input);
  const client = await connectSsh(config);
  try {
    await new Promise<void>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);

        if (input.isDirectory) {
          // For directories, first check if empty, then rmdir
          // If non-empty, recursively delete contents first
          sftp.readdir(input.remotePath, (readErr, entries) => {
            if (readErr) {
              // If we can't read it, try rmdir anyway
              sftp.rmdir(input.remotePath, (rmdirErr) => {
                if (rmdirErr) reject(rmdirErr);
                else resolve();
              });
              return;
            }

            if (entries.length === 0) {
              sftp.rmdir(input.remotePath, (rmdirErr) => {
                if (rmdirErr) reject(rmdirErr);
                else resolve();
              });
            } else {
              // Non-empty directory — reject with helpful error
              reject(new Error("目录非空，无法删除。请先删除目录中的所有文件。"));
            }
          });
        } else {
          sftp.unlink(input.remotePath, (unlinkErr) => {
            if (unlinkErr) reject(unlinkErr);
            else resolve();
          });
        }
      });
    });
  } finally {
    client.end();
  }
}

export async function renameRemoteFile(input: SshConnectionParams & { oldPath: string; newPath: string }): Promise<void> {
  const config = createSshConfig(input);
  const client = await connectSsh(config);
  try {
    await new Promise<void>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        sftp.rename(input.oldPath, input.newPath, (renameErr) => {
          if (renameErr) reject(renameErr);
          else resolve();
        });
      });
    });
  } finally {
    client.end();
  }
}

export async function readRemoteFile(input: SshConnectionParams & { remotePath: string }): Promise<Buffer> {
  const config = createSshConfig(input);
  const client = await connectSsh(config);
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        const chunks: Buffer[] = [];
        const readStream = sftp.createReadStream(input.remotePath);
        readStream.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        readStream.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
readStream.on("error", (readErr: Error) => {
				reject(readErr);
        });
      });
    });
  } finally {
    client.end();
  }
}

export async function writeRemoteFile(input: SshConnectionParams & { remotePath: string; content: string | Buffer }): Promise<void> {
 const config = createSshConfig(input);
 const client = await connectSsh(config);
 try {
 await new Promise<void>((resolve, reject) => {
 client.sftp((err, sftp) => {
 if (err) return reject(err);
 const writeStream = sftp.createWriteStream(input.remotePath);
 writeStream.on("close", () => resolve());
 writeStream.on("error", (writeErr: Error) => reject(writeErr));
 writeStream.end(input.content);
 });
 });
 } finally {
 client.end();
 }
}

/** Execute a command on a remote server via SSH and return stdout/stderr/exit code */
export async function execRemoteCommand(
 input: SshConnectionParams & { command: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
 const config = createSshConfig(input);
 const client = await connectSsh(config);
 try {
 return await new Promise((resolve, reject) => {
 const timeoutMs = input.timeout ?? 120_000;
 const timer = setTimeout(() => {
 reject(new Error(`Command timed out after ${timeoutMs / 1000}s`));
 client.end();
 }, timeoutMs);

 client.exec(input.command, (err, stream) => {
 if (err) { clearTimeout(timer); reject(err); return; }
 let stdout = "";
 let stderr = "";
 stream.on("data", (data: Buffer) => { stdout += data.toString(); });
 stream.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
 stream.on("close", (code: number | null) => {
 clearTimeout(timer);
 resolve({ stdout, stderr, exitCode: code });
 });
 });
 });
 } finally {
 client.end();
 }
}

/** Build SSH connection params from a Server + SshKey record */
export async function buildSshParamsFromServer(server: {
 host: string;
 port: number;
 username: string;
 sshKeyId: string | null;
 password: string | null;
}, sshKey?: { privateKey: string | null } | null): Promise<SshConnectionParams> {
 return {
 host: server.host,
 port: server.port,
 username: server.username,
 ...(sshKey?.privateKey ? { privateKey: decryptSshPrivateKey(sshKey.privateKey) } : {}),
 ...(server.password ? { password: decryptServerPassword(server.password) } : {}),
 };
}
