/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sftpOpenCount: 0, largeDirectoryReads: 0 }));

type Attrs = { mode: number; size: number; mtime: number; atime: number; isFile: () => boolean; isDirectory: () => boolean };
const attrs = (mode: number, size = 0): Attrs => ({
  mode,
  size,
  mtime: 1_700_000_000,
  atime: 1_700_000_000,
  isFile: () => (mode & 0o170000) === 0o100000,
  isDirectory: () => (mode & 0o170000) === 0o040000,
});
const DIR = 0o040755, FILE = 0o100644, LINK = 0o120777;

// /home/alice: a real folder, a link to a folder, a link to a file, a dangling
// link and 30 more links to folders. stat follows links; readdir does not.
const listing = [
  { filename: "projects", longname: "", attrs: attrs(DIR) },
  { filename: "www", longname: "", attrs: attrs(LINK, 8) },
  { filename: "notes.txt", longname: "", attrs: attrs(LINK, 9) },
  { filename: "gone", longname: "", attrs: attrs(LINK, 4) },
  ...Array.from({ length: 30 }, (_, i) => ({ filename: `l${i}`, longname: "", attrs: attrs(LINK, 2) })),
];
const targets: Record<string, Attrs> = {
  "/home/alice/www": attrs(DIR),
  "/home/alice/notes.txt": attrs(FILE, 1234),
  ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`/home/alice/l${i}`, attrs(DIR)])),
};

vi.mock("ssh2", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeClient extends EventEmitter {
    connect() { queueMicrotask(() => this.emit("ready")); return this; }
    sftp(callback: (error: Error | undefined, sftp: unknown) => void) {
      state.sftpOpenCount += 1;
      let read = false;
      callback(undefined, {
        opendir: (path: string, done: (error?: Error, handle?: Buffer) => void) => path.endsWith("/private")
          ? done(Object.assign(new Error("Permission denied"), { code: 3 })) : done(undefined, Buffer.from(path)),
        readdir: (handle: Buffer, done: (error?: Error, entries?: unknown[]) => void) => {
          if (handle.toString().endsWith("/large")) {
            const page = state.largeDirectoryReads++;
            if (page >= 90) return done(Object.assign(new Error("EOF"), { code: 1 }));
            const longname = "文".repeat(340);
            return done(undefined, Array.from({ length: 100 }, (_, i) => ({
              filename: `item-${page}-${i}`, longname, attrs: attrs(FILE, 1),
            })));
          }
          if (read) return done(Object.assign(new Error("EOF"), { code: 1 }));
          read = true;
          done(undefined, listing);
        },
        realpath: (path: string, done: (error?: Error, result?: string) => void) => done(undefined, path.endsWith("/notes.txt") ? "/outside/notes.txt" : path),
        stat: (path: string, done: (error: (Error & { code?: number }) | undefined, value?: Attrs) => void) => {
          const target = targets[path];
          if (target) done(undefined, target);
          else done(Object.assign(new Error("No such file"), { code: 2 }));
        },
        end: () => undefined,
      });
    }
    end() { this.emit("close"); }
  }
  return { Client: FakeClient };
});

vi.mock("@/lib/ssh/server-target", () => ({
  loadEnabledServerForSftp: async () => ({
    server: {},
    ssh: { host: "203.0.113.10", port: 22, username: "alice", password: "secret", hostKeySha256: "SHA256:pinned" },
    rootPath: "/home/alice",
  }),
}));

import { closeSshPool, listRemoteDirectoryPage } from "@/lib/ssh/client";
import { listDirectory } from "@/lib/ssh/sftp-service";

describe("SFTP file manager listing with symbolic links", () => {
  afterEach(async () => {
    await closeSshPool();
    state.sftpOpenCount = 0;
    state.largeDirectoryReads = 0;
  });

  it("opens a linked folder and downloads a linked file, as their targets", async () => {
    const { entries } = await listDirectory("srv", "/home/alice");
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));

    expect(byName.projects).toMatchObject({ isDirectory: true, isSymlink: false });
    // A link to a folder used to be neither a folder nor a file: not enterable.
    expect(byName.www).toMatchObject({ isDirectory: true, isFile: false, isSymlink: true });
    // A link to a file had no download action.
    expect(byName["notes.txt"]).toMatchObject({ isDirectory: false, isFile: true, isSymlink: true, size: 1234 });
    // A link that points nowhere is still shown, as a link.
    expect(byName.gone).toMatchObject({ isDirectory: false, isFile: false, isSymlink: true });
  });

  it("keeps the link's own size and type when its target leaves the authorized root", async () => {
    const ssh = { host: "fixture", username: "alice", port: 22, password: "test", hostKeySha256: "pin" };
    const { entries } = await listDirectory("srv", "/home/alice", { ssh, root: { path: "/home/alice", windows: false } });
    expect(entries.find(entry => entry.name === "notes.txt")).toMatchObject({ isSymlink: true, isFile: false, size: 9 });
    expect(entries.find(entry => entry.name === "www")?.isDirectory).toBe(true);
    const page = await listRemoteDirectoryPage({ ...ssh, remotePath: "/home/alice", maxEntries: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.truncated).toBe(true);
  });

  it("resolves every link over one SFTP channel instead of one per link", async () => {
    await listDirectory("srv", "/home/alice");
    // One channel lists, one stats all 33 links: a channel per link ran into
    // OpenSSH's default limit of ten sessions per connection.
    expect(state.sftpOpenCount).toBe(2);
  });

  it("stops reading directory handles at the byte budget before the entry limit", async () => {
    const { entries, truncated } = await listDirectory("srv", "/home/alice/large");
    expect(truncated).toBe(true);
    expect(entries.length).toBeGreaterThan(100);
    expect(state.largeDirectoryReads).toBeLessThan(90);
    expect(entries.reduce((bytes, entry) => bytes + Buffer.byteLength(entry.longname) + Buffer.byteLength(entry.name), 0))
      .toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it("says a folder the account may not read is forbidden, not a server failure", async () => {
    // A 500 "list failed" told the user nothing; delete/mkdir/rename already
    // mapped the same SFTP status to "permission denied".
    await expect(listDirectory("srv", "/home/alice/private")).rejects.toMatchObject({ status: 403 });
  });
});
