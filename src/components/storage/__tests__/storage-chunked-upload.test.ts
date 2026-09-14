import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  uploadStorageFileChunked,
  cancelStorageFileUpload,
} from "../storage-chunked-upload";

describe("storage chunk transport", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "csrf_token=chunk-token; path=/";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.cookie = "csrf_token=; path=/; max-age=0";
  });
  it("waits for Retry-After on rate limiting and can pause during that wait", async () => {
    vi.useFakeTimers();
    const file = new File(["a"], "limited.txt");
    const session = {
      id: "limited",
      totalSize: 1,
      totalChunks: 1,
      chunkSize: 1,
      receivedChunks: [],
    };
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes("/chunk?")) {
          attempts++;
          if (attempts === 1)
            return new Response("{}", {
              status: 429,
              headers: { "Retry-After": "2" },
            });
          return new Response(
            JSON.stringify({ session: { ...session, receivedChunks: [0] } }),
          );
        }
        return new Response(
          JSON.stringify({
            session,
            size: 1,
            relativePath: file.name,
            storageNodeId: "node",
          }),
        );
      }),
    );
    const upload = uploadStorageFileChunked({
      file,
      storageNodeId: "node",
      relativePath: file.name,
    });
    await vi.waitFor(() => expect(attempts).toBe(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(upload).resolves.toMatchObject({ size: 1 });
    expect(attempts).toBe(2);

    localStorage.clear();
    attempts = 0;
    const controller = new AbortController();
    const paused = uploadStorageFileChunked({
      file,
      storageNodeId: "node",
      relativePath: file.name,
      signal: controller.signal,
    });
    const rejected = expect(paused).rejects.toThrow();
    await vi.waitFor(() => expect(attempts).toBe(1));
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempts).toBe(1);
  });
  it("reconciles a lost completion response without uploading or overwriting again", async () => {
    const file = new File(["proof"], "proof.txt", { lastModified: 123 });
    const session = {
      id: "recover",
      storageNodeId: "node",
      relativePath: file.name,
      totalSize: file.size,
      totalChunks: 1,
      chunkSize: 5,
      receivedChunks: [0],
      status: "UPLOADING",
    };
    let completed = false;
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/complete")) {
        completed = true;
        throw new TypeError("response lost");
      }
      return new Response(
        JSON.stringify({
          session: {
            ...session,
            status: completed ? "COMPLETED" : "UPLOADING",
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      uploadStorageFileChunked({
        file,
        storageNodeId: "node",
        relativePath: file.name,
      }),
    ).rejects.toThrow("response lost");
    await expect(
      uploadStorageFileChunked({
        file,
        storageNodeId: "node",
        relativePath: file.name,
      }),
    ).resolves.toMatchObject({ size: 5 });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/storage/upload/init",
      "/api/storage/upload/recover/complete",
      "/api/images/upload/recover",
    ]);
  });
  it("retains an initializing session after pause so cancellation can remove it", async () => {
    const controller = new AbortController();
    const file = new File(["proof"], "proof.txt", { lastModified: 123 });
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/init")) {
        controller.abort();
        return new Response(
          JSON.stringify({ session: { id: "cancel-me", receivedChunks: [] } }),
        );
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      uploadStorageFileChunked({
        file,
        storageNodeId: "node",
        relativePath: file.name,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    await cancelStorageFileUpload(file, "node", file.name);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/images/upload/cancel-me",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(localStorage.length).toBe(0);
  });
  it("does not treat a resume network failure as permission to create another session", async () => {
    const file = new File(["proof"], "proof.txt", { lastModified: 123 });
    const session = {
      id: "recover",
      storageNodeId: "node",
      relativePath: file.name,
      totalSize: file.size,
      totalChunks: 1,
      chunkSize: 5,
      receivedChunks: [0],
      status: "UPLOADING",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ session })))
      .mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      uploadStorageFileChunked({
        file,
        storageNodeId: "node",
        relativePath: file.name,
      }),
    ).rejects.toThrow("offline");
    await expect(
      uploadStorageFileChunked({
        file,
        storageNodeId: "node",
        relativePath: file.name,
      }),
    ).rejects.toThrow("offline");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![0]).toBe("/api/images/upload/recover");
    expect(localStorage.length).toBe(1);
  });
  it.each([false, true])(
    "preserves bytes and exposes chunk errors (failure=%s)",
    async (failure) => {
      const bytes = new Uint8Array([0, 128, 255]);
      const file = new File([bytes], "data.bin", { lastModified: 123 });
      const session = {
        id: "chunk/session",
        totalSize: 3,
        totalChunks: 1,
        chunkSize: 3,
        receivedChunks: [],
      };
      const fetchMock = vi.fn(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          if (String(url).includes("/chunk?")) {
            expect(init?.body).toBeInstanceOf(ArrayBuffer);
            expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(bytes);
            const headers = new Headers(init?.headers);
            expect(headers.get("Content-Type")).toBe(
              "application/octet-stream",
            );
            expect(headers.get("x-csrf-token")).toBe("chunk-token");
            if (failure)
              return new Response(
                JSON.stringify({ error: "Chunk quota exceeded" }),
                { status: 413 },
              );
            return new Response(
              JSON.stringify({ session: { ...session, receivedChunks: [0] } }),
            );
          }
          return new Response(
            JSON.stringify({
              session,
              storageNodeId: "node",
              relativePath: "data.bin",
              size: 3,
            }),
          );
        },
      );
      vi.stubGlobal("fetch", fetchMock);
      const upload = uploadStorageFileChunked({
        file,
        storageNodeId: "node",
        relativePath: "data.bin",
      });
      if (failure) await expect(upload).rejects.toThrow("Chunk quota exceeded");
      else await expect(upload).resolves.toMatchObject({ size: 3 });
      expect(fetchMock).toHaveBeenCalledTimes(failure ? 2 : 3);
    },
  );

  it("keeps progress monotonic when parallel chunk responses arrive out of order", async () => {
    const file = new File([new Uint8Array(6)], "parallel.bin", {
      lastModified: 123,
    });
    const session = {
      id: "parallel",
      totalSize: 6,
      totalChunks: 2,
      chunkSize: 3,
      receivedChunks: [] as number[],
    };
    const pending = new Map<number, (response: Response) => void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes("/chunk?")) {
          const index = Number(
            new URL(String(url), window.location.origin).searchParams.get(
              "index",
            ),
          );
          return new Promise<Response>((resolve) =>
            pending.set(index, resolve),
          );
        }
        return new Response(
          JSON.stringify({
            session,
            storageNodeId: "node",
            relativePath: file.name,
            size: 6,
          }),
        );
      }),
    );
    const progress: number[] = [];
    const upload = uploadStorageFileChunked({
      file,
      storageNodeId: "node",
      relativePath: file.name,
      onProgress: (value) => progress.push(value.percent),
    });
    await vi.waitFor(() => expect(pending.size).toBe(2));
    pending.get(1)!(
      new Response(
        JSON.stringify({ session: { ...session, receivedChunks: [0, 1] } }),
      ),
    );
    await vi.waitFor(() => expect(progress).toContain(100));
    pending.get(0)!(
      new Response(
        JSON.stringify({ session: { ...session, receivedChunks: [0] } }),
      ),
    );
    await upload;
    expect(progress).toEqual([0, 100, 100, 100]);
  });

  it("stops scheduling after failure and drains active chunks before permitting retry", async () => {
    const file = new File([new Uint8Array(30)], "failure.bin", {
      lastModified: 123,
    });
    const session = {
      id: "parallel-failure",
      totalSize: 30,
      totalChunks: 10,
      chunkSize: 3,
      receivedChunks: [],
    };
    const pending = new Map<number, (response: Response) => void>();
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/chunk?")) {
        const index = Number(
          new URL(String(url), window.location.origin).searchParams.get(
            "index",
          ),
        );
        return new Promise<Response>((resolve) => pending.set(index, resolve));
      }
      return new Response(JSON.stringify({ session }));
    });
    vi.stubGlobal("fetch", fetchMock);
    let settled = false;
    const outcome = uploadStorageFileChunked({
      file,
      storageNodeId: "node",
      relativePath: file.name,
    }).then(
      () => {
        settled = true;
        return null;
      },
      (error: Error) => {
        settled = true;
        return error;
      },
    );
    await vi.waitFor(() => expect(pending.size).toBe(5));
    pending.get(0)!(
      new Response(JSON.stringify({ error: "quota exceeded" }), {
        status: 413,
      }),
    );
    // Let fetch's JSON/error continuations run before the other chunks finish.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    for (let index = 1; index < 5; index += 1) {
      pending.get(index)!(
        new Response(
          JSON.stringify({ session: { ...session, receivedChunks: [index] } }),
        ),
      );
    }
    expect(await outcome).toMatchObject({ message: "quota exceeded" });
    expect(pending.size).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(localStorage.length).toBe(1);
  });
});
