import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { Server, utils, type SFTPWrapper } from "ssh2";

import { generateEd25519KeyPair } from "./ssh-keygen";

const { STATUS_CODE } = utils.sftp;

/**
 * In-process SSH server with an SFTP subsystem backed by the real filesystem,
 * for storage tests that need real symlinks (realpath, lstat, link-following
 * reads and writes behave as on a real host).
 *
 * The account is jailed to `sandbox`: any request for a path outside it fails
 * with PERMISSION_DENIED and is recorded in `outsideRequests`, so a regression
 * can never read or write real host files, and a test can assert that nothing
 * outside the storage root was even opened (`opened`).
 */
export async function startSftpFsServer(options: { sandbox: string; username: string; password: string }) {
  const keys = generateEd25519KeyPair();
  const publicBlob = Buffer.from(keys.public.trim().split(/\s+/)[1]!, "base64");
  const fingerprint = `SHA256:${createHash("sha256").update(publicBlob).digest("base64").replace(/=+$/, "")}`;
  const sandbox = fs.realpathSync(options.sandbox);
  const opened: string[] = [];
  const outsideRequests: string[] = [];
  const clients = new Set<{ end: () => void }>();

  const inSandbox = (target: string) => {
    let real: string;
    try {
      real = fs.realpathSync(target);
    } catch {
      real = path.resolve(fs.realpathSync(path.dirname(target)), path.basename(target));
    }
    return real === sandbox || real.startsWith(`${sandbox}/`);
  };
  // Ancestors of the sandbox (/, /tmp, ...) answer metadata requests like on a
  // real host, so recursive mkdir chains and realpath walks work; nothing in
  // them is ever opened, created or changed.
  const isAncestor = (target: string) => {
    const resolved = path.resolve("/", target);
    return resolved === "/" || sandbox.startsWith(`${resolved}/`);
  };
  const toAttrs = (stats: fs.Stats) => ({
    mode: stats.mode,
    uid: stats.uid,
    gid: stats.gid,
    size: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000),
  });
  const statusFor = (error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? STATUS_CODE.NO_SUCH_FILE : code === "EACCES" ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.FAILURE;
  };

  function serve(sftp: SFTPWrapper) {
    const handles = new Map<string, { fd?: number; dir?: string[]; dirPath?: string }>();
    let next = 0;
    const newHandle = (value: { fd?: number; dir?: string[]; dirPath?: string }) => {
      const handle = Buffer.alloc(4);
      handle.writeUInt32BE(next++);
      handles.set(handle.toString("hex"), value);
      return handle;
    };
    const guard = (reqid: number, target: string) => {
      try {
        if (inSandbox(target)) return true;
      } catch {
        /* parent missing: let the operation report it */
        return true;
      }
      outsideRequests.push(target);
      sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
      return false;
    };
    const run = (reqid: number, target: string, operation: () => void) => {
      if (!guard(reqid, target)) return;
      try {
        operation();
      } catch (error) {
        sftp.status(reqid, statusFor(error));
      }
    };

    const metadata = (reqid: number, target: string, operation: () => void) => {
      if (!isAncestor(target)) return run(reqid, target, operation);
      try {
        operation();
      } catch (error) {
        sftp.status(reqid, statusFor(error));
      }
    };
    sftp.on("REALPATH", (reqid, target) => metadata(reqid, target, () => {
      const real = fs.realpathSync(path.resolve("/", target));
      sftp.name(reqid, [{ filename: real, longname: real, attrs: toAttrs(fs.statSync(real)) }]);
    }));
    sftp.on("LSTAT", (reqid, target) => metadata(reqid, target, () => sftp.attrs(reqid, toAttrs(fs.lstatSync(target)))));
    sftp.on("STAT", (reqid, target) => metadata(reqid, target, () => sftp.attrs(reqid, toAttrs(fs.statSync(target)))));
    sftp.on("OPEN", (reqid, target, flags) => run(reqid, target, () => {
      opened.push(target);
      const fd = fs.openSync(target, utils.sftp.flagsToString(flags) ?? "r");
      sftp.handle(reqid, newHandle({ fd }));
    }));
    sftp.on("FSTAT", (reqid, handle) => {
      const entry = handles.get(handle.toString("hex"));
      if (entry?.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
      sftp.attrs(reqid, toAttrs(fs.fstatSync(entry.fd)));
    });
    sftp.on("READ", (reqid, handle, offset, length) => {
      const entry = handles.get(handle.toString("hex"));
      if (entry?.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
      const buffer = Buffer.alloc(length);
      const read = fs.readSync(entry.fd, buffer, 0, length, offset);
      if (read === 0) return sftp.status(reqid, STATUS_CODE.EOF);
      sftp.data(reqid, buffer.subarray(0, read));
    });
    sftp.on("WRITE", (reqid, handle, offset, data) => {
      const entry = handles.get(handle.toString("hex"));
      if (entry?.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
      fs.writeSync(entry.fd, data, 0, data.length, offset);
      sftp.status(reqid, STATUS_CODE.OK);
    });
    sftp.on("CLOSE", (reqid, handle) => {
      const key = handle.toString("hex");
      const entry = handles.get(key);
      if (entry?.fd !== undefined) fs.closeSync(entry.fd);
      handles.delete(key);
      sftp.status(reqid, STATUS_CODE.OK);
    });
    sftp.on("OPENDIR", (reqid, target) => run(reqid, target, () => {
      opened.push(target);
      sftp.handle(reqid, newHandle({ dir: fs.readdirSync(target), dirPath: target }));
    }));
    sftp.on("READDIR", (reqid, handle) => {
      const entry = handles.get(handle.toString("hex"));
      if (!entry?.dir) return sftp.status(reqid, STATUS_CODE.FAILURE);
      if (entry.dir.length === 0) return sftp.status(reqid, STATUS_CODE.EOF);
      const names = entry.dir.splice(0).map((name) => {
        const stats = fs.lstatSync(path.join(entry.dirPath!, name));
        return { filename: name, longname: `${stats.isDirectory() ? "d" : stats.isSymbolicLink() ? "l" : "-"}rw-r--r-- 1 u g ${stats.size} Jan 1 00:00 ${name}`, attrs: toAttrs(stats) };
      });
      sftp.name(reqid, names);
    });
    sftp.on("MKDIR", (reqid, target) => isAncestor(target) ? sftp.status(reqid, STATUS_CODE.FAILURE) : run(reqid, target, () => { fs.mkdirSync(target); sftp.status(reqid, STATUS_CODE.OK); }));
    sftp.on("RMDIR", (reqid, target) => run(reqid, target, () => { fs.rmdirSync(target); sftp.status(reqid, STATUS_CODE.OK); }));
    sftp.on("REMOVE", (reqid, target) => run(reqid, target, () => { fs.unlinkSync(target); sftp.status(reqid, STATUS_CODE.OK); }));
    sftp.on("RENAME", (reqid, from, to) => {
      if (!guard(reqid, from) || !guard(reqid, to)) return;
      try {
        fs.renameSync(from, to);
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (error) {
        sftp.status(reqid, statusFor(error));
      }
    });
    sftp.on("SETSTAT", (reqid) => sftp.status(reqid, STATUS_CODE.OK));
    sftp.on("FSETSTAT", (reqid) => sftp.status(reqid, STATUS_CODE.OK));
  }

  const server = new Server({ hostKeys: [keys.private] }, (client) => {
    clients.add(client);
    client.on("close", () => clients.delete(client));
    client.on("authentication", (ctx) => {
      if (ctx.method === "password" && ctx.username === options.username && ctx.password === options.password) ctx.accept();
      else ctx.reject(["password"]);
    }).on("ready", () => {
      client.on("session", (acceptSession) => {
        const session = acceptSession();
        session.on("sftp", (accept) => serve(accept()));
        session.on("exec", (_accept, reject) => reject?.());
      });
    }).on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const close = () => new Promise<void>((resolve) => {
    for (const client of clients) client.end();
    server.close(() => resolve());
  });
  return { port, fingerprint, opened, outsideRequests, close };
}
