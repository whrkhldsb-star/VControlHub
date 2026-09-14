// @vitest-environment node
import { PassThrough } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  release: vi.fn(),
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
  mocks.lock.mockResolvedValue(mocks.release);
  mocks.release.mockResolvedValue(undefined);
  mocks.deleted.mockResolvedValue([]);
});
const base = {
  storageNodeId: "node",
  relativePath: "parent/docs",
  signal: new AbortController().signal,
};

it("holds the mutation lock through streaming and releases it once", async () => {
  const stream = new PassThrough();
  mocks.deleted.mockResolvedValue([{ relativePath: "parent/docs/trash" }]);
  const open = vi.fn(() => stream);
  await openManagedArchive({ ...base, open });
  expect(open).toHaveBeenCalledWith(["docs/trash"]);
  expect(mocks.release).not.toHaveBeenCalled();
  stream.emit("end");
  stream.emit("close");
  expect(mocks.release).toHaveBeenCalledOnce();
  stream.destroy();
});

it.each(["parent", "parent/docs"])(
  "refuses an archive deleted before lock acquisition: %s",
  async (relativePath) => {
    mocks.deleted.mockResolvedValue([{ relativePath }]);
    const open = vi.fn();
    await expect(openManagedArchive({ ...base, open })).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
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
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("releases on opening failure", async () => {
  await expect(
    openManagedArchive({
      ...base,
      open: () => {
        throw new Error("tar missing");
      },
    }),
  ).rejects.toThrow("tar missing");
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("cancels a stream and releases when the browser aborts", async () => {
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
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("refuses to open while a mutation owns the lock", async () => {
  mocks.lock.mockResolvedValue(null);
  const open = vi.fn();
  await expect(openManagedArchive({ ...base, open })).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
  expect(mocks.deleted).not.toHaveBeenCalled();
});
