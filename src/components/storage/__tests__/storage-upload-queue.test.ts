import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageUploadQueue } from "../storage-upload-queue";
import { uploadStorageFileChunked, cancelStorageFileUpload } from "../storage-chunked-upload";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("../storage-chunked-upload", () => ({ STORAGE_CHUNKED_THRESHOLD_BYTES: 5, uploadStorageFileChunked: vi.fn(), cancelStorageFileUpload: vi.fn() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));
const upload = vi.mocked(uploadStorageFileChunked);
const cancel = vi.mocked(cancelStorageFileUpload);
const file = (name: string) => ({ file: new File(["123456"], name), path: `docs/${name}` });
const done = { relativePath: "docs/a", size: 6 } as Awaited<ReturnType<typeof uploadStorageFileChunked>>;
beforeEach(() => { vi.resetAllMocks(); cancel.mockResolvedValue(undefined); });

describe("StorageUploadQueue", () => {
  it("limits concurrency and retains the captured node and path", async () => {
    const pending: Array<(value: typeof done) => void> = [];
    upload.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const queue = new StorageUploadQueue();
    queue.enqueue([file("a"), file("b"), file("c")], "original-node");
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0]![0]).toMatchObject({ storageNodeId: "original-node", relativePath: "docs/a" });
    pending[0]!(done);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    pending[1]!(done); pending[2]!(done);
    await vi.waitFor(() => expect(queue.getSnapshot().every((item) => item.state === "success")).toBe(true));
    queue.resume(queue.getSnapshot()[0]!.id);
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it("drains paused requests before enabling resume and publishes a new snapshot", async () => {
    let reject!: (error: Error) => void;
    upload.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(done);
    const queue = new StorageUploadQueue();
    const [id] = queue.enqueue([file("a")], "node");
    queue.pause(id!);
    expect(upload.mock.calls[0]![0].signal?.aborted).toBe(true);
    const paused = queue.getSnapshot();
    queue.resume(id!);
    expect(upload).toHaveBeenCalledTimes(1);
    reject(new DOMException("aborted", "AbortError"));
    await vi.waitFor(() => expect(queue.isSettling(id!)).toBe(false));
    expect(queue.getSnapshot()).not.toBe(paused);
    queue.resume(id!);
    await vi.waitFor(() => expect(queue.getSnapshot()[0]!.state).toBe("success"));
  });

  it("retries cancellation cleanup without starting another upload", async () => {
    upload.mockRejectedValue(new Error("connection lost"));
    cancel.mockRejectedValueOnce(new Error("cleanup unavailable")).mockResolvedValue(undefined);
    const queue = new StorageUploadQueue();
    const [id] = queue.enqueue([file("a")], "node");
    await vi.waitFor(() => expect(queue.getSnapshot()[0]!.state).toBe("error"));
    queue.cancel(id!);
    queue.clearFinished();
    expect(queue.getSnapshot()).toHaveLength(1);
    await vi.waitFor(() => expect(queue.getSnapshot()[0]!.state).toBe("cancel-error"));
    queue.resume(id!);
    await vi.waitFor(() => expect(queue.getSnapshot()[0]!.state).toBe("cancelled"));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("locks cancellation and pause during finalization", async () => {
    let finish!: (value: typeof done) => void;
    upload.mockImplementation(({ onFinalizing }) => { onFinalizing?.(); return new Promise((resolve) => { finish = resolve; }); });
    const queue = new StorageUploadQueue();
    const [id] = queue.enqueue([file("a")], "node");
    queue.cancel(id!); queue.pause(id!);
    expect(queue.getSnapshot()[0]!.state).toBe("finalizing");
    expect(upload.mock.calls[0]![0].signal?.aborted).toBe(false);
    finish(done);
    await vi.waitFor(() => expect(queue.getSnapshot()[0]!.state).toBe("success"));
  });

  it("does not blindly retry a single-shot upload with an unknown commit result", async () => {
    vi.mocked(csrfFetch).mockRejectedValue(new TypeError("network error"));
    const queue = new StorageUploadQueue();
    const [id] = queue.enqueue([{ file: new File(["a"], "small"), path: "small" }], "node");
    await vi.waitFor(() => expect(queue.getSnapshot()[0]!.state).toBe("unknown"));
    queue.resume(id!); queue.cancel(id!);
    expect(csrfFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate destinations before starting any request", () => {
    const queue = new StorageUploadQueue();
    expect(() => queue.enqueue([file("a"), file("a")], "node")).toThrow("storageUpload.duplicate");
    expect(upload).not.toHaveBeenCalled();
    expect(queue.getSnapshot()).toHaveLength(0);
  });

  it("stops scheduling when the owner is disposed", async () => {
    upload.mockImplementation(({ signal }) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("abort", "AbortError")))));
    const queue = new StorageUploadQueue();
    queue.enqueue([file("a"), file("b"), file("c")], "node");
    queue.dispose();
    await vi.waitFor(() => expect(queue.isSettling(queue.getSnapshot()[0]!.id)).toBe(false));
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
