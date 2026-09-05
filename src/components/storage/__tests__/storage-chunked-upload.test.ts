import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadStorageFileChunked } from "../storage-chunked-upload";

describe("storage chunk transport", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "csrf_token=chunk-token; path=/";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.cookie = "csrf_token=; path=/; max-age=0";
  });
  it.each([false, true])("preserves bytes and exposes chunk errors (failure=%s)", async (failure) => {
    const bytes = new Uint8Array([0, 128, 255]);
    const file = new File([bytes], "data.bin", { lastModified: 123 });
    const session = { id: "chunk/session", totalSize: 3, totalChunks: 1, chunkSize: 3, receivedChunks: [] };
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/chunk?")) {
        expect(init?.body).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(bytes);
        const headers = new Headers(init?.headers);
        expect(headers.get("Content-Type")).toBe("application/octet-stream");
        expect(headers.get("x-csrf-token")).toBe("chunk-token");
        if (failure) return new Response(JSON.stringify({ error: "Chunk quota exceeded" }), { status: 413 });
        return new Response(JSON.stringify({ session: { ...session, receivedChunks: [0] } }));
      }
      return new Response(JSON.stringify({ session, storageNodeId: "node", relativePath: "data.bin", size: 3 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const upload = uploadStorageFileChunked({ file, storageNodeId: "node", relativePath: "data.bin" });
    if (failure) await expect(upload).rejects.toThrow("Chunk quota exceeded");
    else await expect(upload).resolves.toMatchObject({ size: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(failure ? 2 : 3);
  });
});
