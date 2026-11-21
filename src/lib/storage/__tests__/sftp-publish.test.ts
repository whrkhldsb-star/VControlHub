/** @vitest-environment node */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@/lib/ssh/client", () => ({ connectSsh: connection.connect }));
vi.mock("../ssh-credentials", () => ({ resolveStorageSshCredentials: () => ({ password: "test" }) }));
vi.mock("../remote-containment", () => ({
  resolveStorageRemotePath: async (_node: unknown, relative: string) => ({ remotePath: "/root/" + relative }),
}));

import { writeStorageFileFromLocalPath, type StorageFileNode } from "../file-content";

type Done = (error?: Error | null) => void;
const destination = "/root/file";
const files = new Map<string, string>();
const unsupported = Object.assign(new Error("Operation unsupported"), { code: 8 });
const sftp = {
  stat: (_path: string, done: Done) => done(null),
  lstat: (name: string, done: (err: Error | null, attrs?: { isFile(): boolean }) => void) => {
    if (files.has(name)) done(null, { isFile: () => true });
    else done(Object.assign(new Error("missing"), { code: 2 }));
  },
  createWriteStream(name: string) {
    const chunks: Buffer[] = [];
    return new Writable({
      write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
      final(done) { files.set(name, Buffer.concat(chunks).toString()); done(); },
    });
  },
  ext_openssh_rename: vi.fn((_from: string, _to: string, done: Done) => done(unsupported)),
  rename: vi.fn(),
  unlink: vi.fn((name: string, done: Done) => { files.delete(name); done(); }),
};

function renameExclusive(from: string, to: string, done: Done) {
  if (!files.has(from) || files.has(to)) return done(new Error("rename refused"));
  files.set(to, files.get(from)!);
  files.delete(from);
  done();
}

let root: string;
const publish = () => writeStorageFileFromLocalPath({ driver: "SFTP" } as StorageFileNode, "file", path.join(root, "upload"));

beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(path.join(tmpdir(), "sftp-publish-"));
  await writeFile(path.join(root, "upload"), "new");
  files.clear();
  connection.connect.mockResolvedValue({
    sftp(done: (err: null, channel: typeof sftp) => void) { done(null, sftp); },
    end() {},
  });
  sftp.rename.mockImplementation(renameExclusive);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("uses ordinary exclusive rename for a new target", async () => {
  await publish();
  expect([...files]).toEqual([[destination, "new"]]);
  expect(sftp.ext_openssh_rename).not.toHaveBeenCalled();
  expect(sftp.unlink).not.toHaveBeenCalled();
});

it.each(["callback", "synchronous throw"])("moves the old target to a backup for unsupported extension (%s)", async mode => {
  files.set(destination, "old");
  if (mode === "synchronous throw") {
    sftp.ext_openssh_rename.mockImplementationOnce(() => { throw new Error("Server does not support this extended request"); });
  }
  await publish();
  expect([...files]).toEqual([[destination, "new"]]);
  expect(sftp.rename).toHaveBeenNthCalledWith(1, destination, expect.stringContaining(".vch-backup-"), expect.any(Function));
  expect(sftp.unlink).not.toHaveBeenCalledWith(destination, expect.anything());
});

it.each(["backup", "publish"])("keeps the old bytes on %s rename failure", async phase => {
  files.set(destination, "old");
  sftp.rename.mockImplementation((from: string, to: string, done: Done) => {
    if ((phase === "backup" && from === destination) || (phase === "publish" && from.includes(".vch-upload-"))) {
      return done(new Error("rename denied"));
    }
    renameExclusive(from, to, done);
  });
  await expect(publish()).rejects.toThrow("rename denied");
  expect([...files]).toEqual([[destination, "old"]]);
  expect(sftp.unlink).not.toHaveBeenCalledWith(destination, expect.anything());
});
