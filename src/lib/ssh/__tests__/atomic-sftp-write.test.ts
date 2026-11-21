// @vitest-environment node
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import type { SFTPWrapper } from "ssh2";
import { describe, expect, it, vi } from "vitest";
import { atomicSftpWrite } from "../sftp-operations";

describe("atomic SFTP replacement", () => {
  const target = "/home/test/report";
  function remote() {
    const files = new Map([[target, "original"]]);
    const metadata = { mode: 0o640, uid: 10, gid: 20, isFile: () => true, isSymbolicLink: () => false };
    const sftp = {
      lstat: (_: string, cb: (e: null, value: typeof metadata) => void) => cb(null, metadata),
      open: vi.fn((path: string, flags: string, mode: number, cb: (e: null, h: Buffer) => void) => {
        expect(flags).toBe("wx");
        expect(mode).toBe(0o600);
        expect(files.has(path)).toBe(false);
        files.set(path, "");
        cb(null, Buffer.from("handle"));
      }),
      fstat: (_: Buffer, cb: (e: null, value: typeof metadata) => void) => cb(null, { ...metadata, mode: 0o600 }),
      createWriteStream: (path: string) => {
        const stream = new PassThrough();
        stream.on("data", data => files.set(path, files.get(path)! + data.toString()));
        return stream;
      },
      chmod: vi.fn((_path: string, _mode: number, cb: () => void) => cb()),
      ext_openssh_rename: vi.fn((from: string, to: string, cb: () => void) => {
        files.set(to, files.get(from)!);
        files.delete(from);
        cb();
      }),
      unlink: (name: string, cb: () => void) => { files.delete(name); cb(); },
    };
    return { files, sftp, channel: sftp as unknown as SFTPWrapper };
  }

  it("publishes only after finish and remote close, preserving permissions", async () => {
    const { channel, files, sftp } = remote();
    await atomicSftpWrite(channel, target, async stream => {
      const closed = once(stream as EventEmitter, "close");
      stream.end("complete");
      expect(files.get(target)).toBe("original");
      await closed;
    });
    expect([...files]).toEqual([[target, "complete"]]);
    expect(sftp.chmod).toHaveBeenCalledWith(expect.stringMatching(/^\/home\/test\/\.vch-upload-/), 0o640, expect.any(Function));
  });

  it("removes only the stage after a premature close", async () => {
    const { channel, files, sftp } = remote();
    await expect(atomicSftpWrite(channel, target, async stream => {
      const closed = once(stream as EventEmitter, "close");
      stream.write("partial");
      stream.destroy();
      await closed;
    })).rejects.toThrow();
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
    expect([...files]).toEqual([[target, "original"]]);
  });
});
