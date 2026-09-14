/**
 * Client-side chunked uploader for ordinary storage files.
 *
 * Reuses the MediaUploadSession chunk pipeline:
 *   POST /api/storage/upload/init
 *   PUT  /api/images/upload/[id]/chunk
 *   POST /api/storage/upload/[id]/complete
 *
 * Resume via localStorage fingerprint (filename+size+mtime).
 */
"use client";

import { csrfFetch } from "@/lib/auth/csrf-client";
import {
  DEFAULT_CHUNK_SIZE,
  type MediaUploadSessionView,
} from "@/lib/upload/types";

export const STORAGE_CHUNKED_THRESHOLD_BYTES = DEFAULT_CHUNK_SIZE;
const MAX_CONCURRENT_CHUNKS = 5;
const STORAGE_PREFIX = "vcStorageUploadSession:";

export type StorageChunkedProgress = {
  totalChunks: number;
  receivedChunks: number[];
  bytesUploaded: number;
  totalBytes: number;
  percent: number;
  resumed: boolean;
  skipped: number;
};

export type StorageChunkedResult = {
  session: MediaUploadSessionView;
  relativePath: string;
  size: number;
  storageNodeId: string;
};

type PersistedSession = {
  sessionId: string;
  filename: string;
  size: number;
  lastModified: number;
  relativePath: string;
  storageNodeId: string;
};

function storageKey(
  file: File,
  storageNodeId: string,
  relativePath: string,
  scope = "",
) {
  return `${STORAGE_PREFIX}${scope}:${storageNodeId}:${relativePath}:${file.name}:${file.size}:${file.lastModified}`;
}

function loadPersistedSession(
  file: File,
  storageNodeId: string,
  relativePath: string,
  scope = "",
): PersistedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      storageKey(file, storageNodeId, relativePath, scope),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    if (
      parsed.filename !== file.name ||
      parsed.size !== file.size ||
      parsed.storageNodeId !== storageNodeId ||
      parsed.relativePath !== relativePath
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function savePersistedSession(
  file: File,
  storageNodeId: string,
  relativePath: string,
  sessionId: string,
  scope = "",
) {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedSession = {
      sessionId,
      filename: file.name,
      size: file.size,
      lastModified: file.lastModified,
      relativePath,
      storageNodeId,
    };
    window.localStorage.setItem(
      storageKey(file, storageNodeId, relativePath, scope),
      JSON.stringify(payload),
    );
  } catch {
    // best-effort
  }
}

function clearPersistedSession(
  file: File,
  storageNodeId: string,
  relativePath: string,
  scope = "",
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(
      storageKey(file, storageNodeId, relativePath, scope),
    );
  } catch {
    // ignore
  }
}

async function putChunk(
  sessionId: string,
  index: number,
  size: number,
  buffer: ArrayBuffer,
  signal?: AbortSignal,
  attempt = 0,
): Promise<MediaUploadSessionView> {
  const resp = await csrfFetch<Response>(
    `/api/images/upload/${encodeURIComponent(sessionId)}/chunk?index=${index}&size=${size}`,
    {
      method: "PUT",
      signal,
      raw: true,
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    },
  );
  if (resp.status === 429 && attempt < 5) {
    const retryAfter = resp.headers.get("retry-after");
    const seconds =
      retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : NaN;
    const delay = Math.min(
      120000,
      Math.max(
        1000,
        Number.isFinite(seconds)
          ? seconds * 1000
          : retryAfter && Number.isFinite(Date.parse(retryAfter))
            ? Date.parse(retryAfter) - Date.now()
            : 60000,
      ),
    );
    await new Promise<void>((resolve, reject) => {
      signal?.throwIfAborted();
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, delay);
      signal?.addEventListener("abort", abort, { once: true });
    });
    return putChunk(sessionId, index, size, buffer, signal, attempt + 1);
  }
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string; message?: string };
      message = body.error || body.message || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const data = (await resp.json()) as { session: MediaUploadSessionView };
  return data.session;
}

async function initOrResumeSession(params: {
  file: File;
  storageNodeId: string;
  relativePath: string;
  signal?: AbortSignal;
  scope?: string;
}): Promise<{
  session: MediaUploadSessionView;
  resumed: boolean;
  skipped: number;
}> {
  const { file, storageNodeId, relativePath, signal, scope } = params;
  signal?.throwIfAborted();
  const persisted = loadPersistedSession(
    file,
    storageNodeId,
    relativePath,
    scope,
  );
  if (persisted?.sessionId) {
    try {
      const view = await csrfFetch<{ session: MediaUploadSessionView | null }>(
        `/api/images/upload/${encodeURIComponent(persisted.sessionId)}`,
        { signal },
      );
      const existing = view.session;
      if (existing?.status === "FINALIZING") {
        // A previous completion request may still own the write. Preserve its
        // fingerprint so retry checks that same session instead of overwriting.
        throw new Error("storageUpload.finalizing");
      }
      if (
        existing &&
        ["PENDING", "UPLOADING", "COMPLETED"].includes(existing.status) &&
        existing.totalSize === Number(file.size) &&
        existing.storageNodeId === storageNodeId &&
        existing.relativePath === relativePath
      ) {
        return {
          session: existing,
          resumed: true,
          skipped: existing.receivedChunks.length,
        };
      }
    } catch (error) {
      // Only an expired/missing session permits creating a new upload. Network
      // failures can hide a successful commit and must remain retryable.
      signal?.throwIfAborted();
      if (!(
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 404
      ))
        throw error;
    }
    clearPersistedSession(file, storageNodeId, relativePath, scope);
  }

  const init = await csrfFetch<{ session: MediaUploadSessionView }>(
    "/api/storage/upload/init",
    {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        totalSize: file.size,
        storageNodeId,
        relativePath,
      }),
    },
  );
  savePersistedSession(
    file,
    storageNodeId,
    relativePath,
    init.session.id,
    scope,
  );
  return { session: init.session, resumed: false, skipped: 0 };
}

export async function cancelStorageFileUpload(
  file: File,
  storageNodeId: string,
  relativePath: string,
  scope = "",
) {
  const persisted = loadPersistedSession(
    file,
    storageNodeId,
    relativePath,
    scope,
  );
  if (persisted) {
    try {
      await csrfFetch(
        `/api/images/upload/${encodeURIComponent(persisted.sessionId)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 404
      ))
        throw error;
    }
  }
  clearPersistedSession(file, storageNodeId, relativePath, scope);
}

export async function uploadStorageFileChunked(params: {
  file: File;
  storageNodeId: string;
  relativePath: string;
  onProgress?: (progress: StorageChunkedProgress) => void;
  signal?: AbortSignal;
  scope?: string;
  onFinalizing?: () => void;
}): Promise<StorageChunkedResult> {
  const {
    file,
    storageNodeId,
    relativePath,
    onProgress,
    signal,
    onFinalizing,
    scope,
  } = params;
  const { session, resumed, skipped } = await initOrResumeSession({
    file,
    storageNodeId,
    relativePath,
    signal,
    scope,
  });

  if (session.status === "COMPLETED") {
    clearPersistedSession(file, storageNodeId, relativePath, scope);
    return { session, relativePath, size: file.size, storageNodeId };
  }
  signal?.throwIfAborted();

  const totalChunks = session.totalChunks;
  const chunkSize = session.chunkSize;
  const totalBytes = Number(session.totalSize);

  const emit = (received: number[]) => {
    const bytes = received.reduce(
      (acc, idx) =>
        acc + Math.min(chunkSize, Math.max(0, totalBytes - idx * chunkSize)),
      0,
    );
    onProgress?.({
      totalChunks,
      receivedChunks: [...received],
      bytesUploaded: bytes,
      totalBytes,
      percent: Math.min(
        100,
        Math.round((bytes / Math.max(1, totalBytes)) * 100),
      ),
      resumed,
      skipped,
    });
  };

  emit(session.receivedChunks);

  const receivedSet = new Set(session.receivedChunks);
  const todo: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!receivedSet.has(i)) todo.push(i);
  }

  let cursor = 0;
  let failed = false;
  const runWorker = async () => {
    try {
      while (!failed && cursor < todo.length) {
        signal?.throwIfAborted();
        const idx = todo[cursor++]!;
        const start = idx * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const slice = file.slice(start, end);
        const buf = await slice.arrayBuffer();
        if (failed) return;
        signal?.throwIfAborted();
        const view = await putChunk(
          session.id,
          idx,
          buf.byteLength,
          buf,
          signal,
        );
        // Concurrent responses can contain older server snapshots.
        for (const received of view.receivedChunks) receivedSet.add(received);
        emit([...receivedSet]);
      }
    } catch (error) {
      failed = true;
      throw error;
    }
  };

  const workerCount = Math.min(MAX_CONCURRENT_CHUNKS, Math.max(todo.length, 0));
  // Drain in-flight chunks before exposing retry to the caller.
  const outcomes = await Promise.allSettled(
    Array.from({ length: workerCount }, () => runWorker()),
  );
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  signal?.throwIfAborted();
  // Once finalization starts, wait for its result rather than implying an
  // aborted HTTP request can undo the committed storage write.
  onFinalizing?.();

  const complete = await csrfFetch<{
    session: MediaUploadSessionView;
    relativePath: string;
    size: number;
    storageNodeId: string;
  }>(`/api/storage/upload/${encodeURIComponent(session.id)}/complete`, {
    method: "POST",
  });

  clearPersistedSession(file, storageNodeId, relativePath, scope);
  onProgress?.({
    totalChunks,
    receivedChunks: complete.session.receivedChunks,
    bytesUploaded: totalBytes,
    totalBytes,
    percent: 100,
    resumed,
    skipped,
  });

  return {
    session: complete.session,
    relativePath: complete.relativePath,
    size: complete.size,
    storageNodeId: complete.storageNodeId,
  };
}
