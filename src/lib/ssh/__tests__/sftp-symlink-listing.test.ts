/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sftpOpenCount: 0 }));

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
      callback(undefined, {
        readdir: (_path: string, done: (error: Error | undefined, entries: unknown[]) => void) => done(undefined, listing),
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

import { closeSshPool } from "@/lib/ssh/client";
import { listDirectory } from "@/lib/ssh/sftp-service";

describe("SFTP file manager listing with symbolic links", () => {
  afterEach(async () => {
    await closeSshPool();
    state.sftpOpenCount = 0;
  });

  it("opens a linked folder and downloads a linked file, as their targets", async () => {
    const entries = await listDirectory("srv", "/home/alice");
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));

    expect(byName.projects).toMatchObject({ isDirectory: true, isSymlink: false });
    // A link to a folder used to be neither a folder nor a file: not enterable.
    expect(byName.www).toMatchObject({ isDirectory: true, isFile: false, isSymlink: true });
    // A link to a file had no download action.
    expect(byName["notes.txt"]).toMatchObject({ isDirectory: false, isFile: true, isSymlink: true, size: 1234 });
    // A link that points nowhere is still shown, as a link.
    expect(byName.gone).toMatchObject({ isDirectory: false, isFile: false, isSymlink: true });
  });

  it("resolves every link over one SFTP channel instead of one per link", async () => {
    await listDirectory("srv", "/home/alice");
    // One channel lists, one stats all 33 links: a channel per link ran into
    // OpenSSH's default limit of ten sessions per connection.
    expect(state.sftpOpenCount).toBe(2);
  });
});
