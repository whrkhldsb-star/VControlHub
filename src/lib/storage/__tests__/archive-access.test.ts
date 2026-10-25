// @vitest-environment node
import { PassThrough } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  deleted: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { fileEntry: { findMany: mocks.deleted } },
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({
  tryAcquireAdvisoryLock: mocks.lock,
}));
import { openManagedArchive } from "../archive-access";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.deleted.mockResolvedValue([]);
});
const base = {
  storageNodeId: "node",
  relativePath: "parent/docs",
  signal: new AbortController().signal,
};

it("leaves out the recycle bin's contents", async () => {
  const stream = new PassThrough();
  mocks.deleted.mockResolvedValue([{ relativePath: "parent/docs/trash" }]);
  const open = vi.fn(() => stream);
  await openManagedArchive({ ...base, open });
  expect(open).toHaveBeenCalledWith(["docs/trash"]);
  stream.destroy();
});

it("takes no node lock, so the node's file operations and other downloads go on", async () => {
  // Held for the whole stream, it made every delete, move or restore on the
  // node — and every other folder download — fail as busy while one ran.
  mocks.lock.mockResolvedValue(null);
  const stream = new PassThrough();
  await expect(openManagedArchive({ ...base, open: () => stream })).resolves.toBe(stream);
  expect(mocks.lock).not.toHaveBeenCalled();
  stream.destroy();
});

it.each(["parent", "parent/docs"])(
  "refuses an archive whose folder is in the recycle bin: %s",
  async (relativePath) => {
    mocks.deleted.mockResolvedValue([{ relativePath }]);
    const open = vi.fn();
    await expect(openManagedArchive({ ...base, open })).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  },
);

it("does not truncate the deletion list and expose unfiltered bytes", async () => {
  mocks.deleted.mockResolvedValue(
    Array.from({ length: 10001 }, (_, n) => ({
      relativePath: `parent/docs/${n}`,
    })),
  );
  const open = vi.fn();
  await expect(openManagedArchive({ ...base, open })).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
});

it("passes an opening failure on", async () => {
  await expect(
    openManagedArchive({
      ...base,
      open: () => {
        throw new Error("tar missing");
      },
    }),
  ).rejects.toThrow("tar missing");
});

it("cancels the stream when the browser aborts", async () => {
  const controller = new AbortController();
  const stream = new PassThrough();
  const closed = new Promise<void>((resolve) => stream.once("close", resolve));
  await openManagedArchive({
    ...base,
    signal: controller.signal,
    open: () => stream,
  });
  controller.abort();
  await closed;
  expect(stream.destroyed).toBe(true);
});

it("opens nothing for a request already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const open = vi.fn();
  await expect(openManagedArchive({ ...base, signal: controller.signal, open })).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
});
