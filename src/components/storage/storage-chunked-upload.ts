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
import { DEFAULT_CHUNK_SIZE, type MediaUploadSessionView } from "@/lib/upload/types";

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

function storageKey(file: File, storageNodeId: string, relativePath: string) {
  return `${STORAGE_PREFIX}${storageNodeId}:${relativePath}:${file.name}:${file.size}:${file.lastModified}`;
}

function loadPersistedSession(
  file: File,
  storageNodeId: string,
  relativePath: string,
): PersistedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(file, storageNodeId, relativePath));
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
    window.localStorage.setItem(storageKey(file, storageNodeId, relativePath), JSON.stringify(payload));
  } catch {
    // best-effort
  }
}

function clearPersistedSession(file: File, storageNodeId: string, relativePath: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(file, storageNodeId, relativePath));
  } catch {
    // ignore
  }
}

function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const cookie = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("csrf_token="));
  if (!cookie) return null;
  return decodeURIComponent(cookie.split("=").slice(1).join("="));
}

async function putChunk(
  sessionId: string,
  index: number,
  size: number,
  buffer: ArrayBuffer,
): Promise<MediaUploadSessionView> {
  const csrfToken = readCsrfToken();
  const resp = await fetch(
    `/api/images/upload/${encodeURIComponent(sessionId)}/chunk?index=${index}&size=${size}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body: buffer,
    },
  );
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
}): Promise<{ session: MediaUploadSessionView; resumed: boolean; skipped: number }> {
  const { file, storageNodeId, relativePath } = params;
  const persisted = loadPersistedSession(file, storageNodeId, relativePath);
  if (persisted?.sessionId) {
    try {
      const view = await csrfFetch<{ session: MediaUploadSessionView | null }>(
        `/api/images/upload/${encodeURIComponent(persisted.sessionId)}`,
      );
      const existing = view.session;
      if (
        existing &&
        (existing.status === "PENDING" || existing.status === "UPLOADING") &&
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
    } catch {
      // fall through
    }
    clearPersistedSession(file, storageNodeId, relativePath);
  }

  const init = await csrfFetch<{ session: MediaUploadSessionView }>("/api/storage/upload/init", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      totalSize: file.size,
      storageNodeId,
      relativePath,
    }),
  });
  savePersistedSession(file, storageNodeId, relativePath, init.session.id);
  return { session: init.session, resumed: false, skipped: 0 };
}

export async function uploadStorageFileChunked(params: {
  file: File;
  storageNodeId: string;
  relativePath: string;
  onProgress?: (progress: StorageChunkedProgress) => void;
}): Promise<StorageChunkedResult> {
  const { file, storageNodeId, relativePath, onProgress } = params;
  const { session, resumed, skipped } = await initOrResumeSession({
    file,
    storageNodeId,
    relativePath,
  });

  const totalChunks = session.totalChunks;
  const chunkSize = session.chunkSize;
  const totalBytes = Number(session.totalSize);

  const emit = (received: number[]) => {
    const bytes = received.reduce(
      (acc, idx) => acc + Math.min(chunkSize, Math.max(0, totalBytes - idx * chunkSize)),
      0,
    );
    onProgress?.({
      totalChunks,
      receivedChunks: [...received],
      bytesUploaded: bytes,
      totalBytes,
      percent: Math.min(100, Math.round((bytes / Math.max(1, totalBytes)) * 100)),
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
  const runWorker = async () => {
    while (cursor < todo.length) {
      const idx = todo[cursor++]!;
      const start = idx * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const slice = file.slice(start, end);
      const buf = await slice.arrayBuffer();
      const view = await putChunk(session.id, idx, buf.byteLength, buf);
      emit(view.receivedChunks);
    }
  };

  const workerCount = Math.min(MAX_CONCURRENT_CHUNKS, Math.max(todo.length, 0));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  const complete = await csrfFetch<{
    session: MediaUploadSessionView;
    relativePath: string;
    size: number;
    storageNodeId: string;
  }>(`/api/storage/upload/${encodeURIComponent(session.id)}/complete`, {
    method: "POST",
  });

  clearPersistedSession(file, storageNodeId, relativePath);
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
