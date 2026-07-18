/**
 * TR-009 55c: client-side chunked media uploader hook.
 *
 * Splits a File into 5 MiB chunks and drives the three new endpoints:
 *   POST /api/images/upload/init           — open a session
 *   PUT  /api/images/upload/[id]/chunk     — append one chunk
 *   POST /api/images/upload/[id]/complete  — assemble + finalize
 *
 * Resume: if the server already has some chunks (server returns them in
 * `session.receivedChunks`), we skip those indices on retry. localStorage
 * holds `{ sessionId, fileFingerprint }` per filename so a page refresh
 * can detect "this file's session is still on the server" and resume.
 *
 * This hook is intentionally pure (no JSX) so it can be unit-tested
 * without rendering. The panel composes the hook to render the progress
 * UI.
 */
"use client";

import { useCallback, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import {
	DEFAULT_CHUNK_SIZE,
	type MediaUploadSessionView,
} from "@/lib/upload/types";

/** Files ≥ this threshold route through the chunked pipeline. */
export const CHUNKED_THRESHOLD_BYTES = DEFAULT_CHUNK_SIZE;

/** Concurrency cap for parallel chunk PUTs within a single file. */
const MAX_CONCURRENT_CHUNKS = 5;

export type ChunkedUploadStatus =
	| "idle"
	| "initialising"
	| "uploading"
	| "completing"
	| "success"
	| "error";

export interface ChunkedUploadProgress {
	/** Total chunks planned for this file. */
	totalChunks: number;
	/** Indices the server has confirmed (sorted ascending). */
	receivedChunks: number[];
	/** Bytes that have been ACKed (sum of received chunk sizes). */
	bytesUploaded: number;
	/** Total file size in bytes. */
	totalBytes: number;
	/** 0-100 integer percent of bytes uploaded. */
	percent: number;
	/** True if we resumed from a previous session. */
	resumed: boolean;
	/** Number of chunks skipped because the server already had them. */
	skipped: number;
}

export interface ChunkedUploadResult {
	session: MediaUploadSessionView;
	image: { id: string; publicUrl: string };
}

export interface UseChunkedMediaUploadOptions {
	/** Storage node id (optional). */
	storageNodeId?: string;
	/** Relative target path on the storage node (optional). */
	relativePath?: string;
	/** Called every time a chunk ACKs. Useful for progress UI. */
	onProgress?: (progress: ChunkedUploadProgress) => void;
}

export interface ChunkedUploadState {
	status: ChunkedUploadStatus;
	progress: ChunkedUploadProgress | null;
	error: string | null;
}

export interface ChunkedUploaderApi extends ChunkedUploadState {
	upload: (file: File) => Promise<ChunkedUploadResult>;
	reset: () => void;
}

const STORAGE_PREFIX = "vcMediaUploadSession:";

interface PersistedSession {
	sessionId: string;
	filename: string;
	size: number;
	lastChunkSize: number;
	lastModified: number;
}

function storageKey(filename: string, size: number, lastModified: number): string {
	// fingerprint = filename + size + mtime — survives across reloads as long
	// as the user picks the same file again.
	return `${STORAGE_PREFIX}${filename}:${size}:${lastModified}`;
}

function loadPersistedSession(file: File): PersistedSession | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(storageKey(file.name, file.size, file.lastModified));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PersistedSession;
		if (parsed.filename !== file.name || parsed.size !== file.size) return null;
		return parsed;
	} catch {
		return null;
	}
}

function savePersistedSession(file: File, session: PersistedSession): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(storageKey(file.name, file.size, file.lastModified), JSON.stringify(session));
	} catch {
		// best-effort; quota or privacy mode — non-fatal
	}
}

function clearPersistedSession(file: File): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.removeItem(storageKey(file.name, file.size, file.lastModified));
	} catch {
		// ignore
	}
}

function readCsrfToken(): string | null {
	if (typeof document === "undefined") return null;
	const cookie = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("csrf_token="));
	if (!cookie) return null;
	return decodeURIComponent(cookie.split("=").slice(1).join("="));
}

/**
 * PUT a single chunk using raw fetch (csrfFetch is JSON-only). Throws on
 * non-2xx with the server error message extracted.
 */
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

/**
 * Initialise (or re-use) a MediaUploadSession. If a persisted session
 * exists for this fingerprint, GET it first; if the server still has it
 * and it's in PENDING/UPLOADING, we resume by appending only the missing
 * chunks.
 */
async function initOrResumeSession(
	file: File,
	storageNodeId: string | undefined,
	relativePath: string | undefined,
): Promise<{ session: MediaUploadSessionView; resumed: boolean; skipped: number }> {
	const persisted = loadPersistedSession(file);
	if (persisted?.sessionId) {
		try {
			const view = await csrfFetch<{ session: MediaUploadSessionView | null }>(
				`/api/images/upload/${encodeURIComponent(persisted.sessionId)}`,
			);
			const existing = view.session;
			if (
				existing &&
				(existing.status === "PENDING" || existing.status === "UPLOADING") &&
				existing.totalSize === Number(file.size)
			) {
				return { session: existing, resumed: true, skipped: existing.receivedChunks.length };
			}
		} catch {
			// session expired or not found — fall through to a fresh init
		}
		clearPersistedSession(file);
	}
	const initBody: Record<string, unknown> = {
		filename: file.name,
		mimeType: file.type || "application/octet-stream",
		totalSize: file.size,
	};
	if (storageNodeId) initBody.storageNodeId = storageNodeId;
	if (relativePath) initBody.relativePath = relativePath;
	const init = await csrfFetch<{ session: MediaUploadSessionView }>("/api/images/upload/init", {
		method: "POST",
		body: JSON.stringify(initBody),
	});
	savePersistedSession(file, {
		sessionId: init.session.id,
		filename: file.name,
		size: file.size,
		lastChunkSize: init.session.chunkSize,
		lastModified: file.lastModified,
	});
	return { session: init.session, resumed: false, skipped: 0 };
}

function computePercent(received: number[], chunkSize: number, totalBytes: number): number {
	if (totalBytes <= 0) return 0;
	const bytes = received.reduce((acc, idx) => {
		const start = idx * chunkSize;
		const end = Math.min(start + chunkSize, totalBytes);
		return acc + Math.max(0, end - start);
	}, 0);
	return Math.min(100, Math.round((bytes / totalBytes) * 100));
}

export function useChunkedMediaUpload(
	options: UseChunkedMediaUploadOptions = {},
): ChunkedUploaderApi {
	const { storageNodeId, relativePath, onProgress } = options;
	const [state, setState] = useState<ChunkedUploadState>({
		status: "idle",
		progress: null,
		error: null,
	});
	const cancelledRef = useRef(false);

	const emit = useCallback(
		(next: ChunkedUploadState) => {
			setState(next);
			if (next.progress && onProgress) onProgress(next.progress);
		},
		[onProgress],
	);

	const reset = useCallback(() => {
		cancelledRef.current = false;
		setState({ status: "idle", progress: null, error: null });
	}, []);

	const upload = useCallback(
		async (file: File): Promise<ChunkedUploadResult> => {
			cancelledRef.current = false;
			try {
				emit({ status: "initialising", progress: null, error: null });
				const { session, resumed, skipped } = await initOrResumeSession(
					file,
					storageNodeId,
					relativePath,
				);
				if (cancelledRef.current) throw new Error("cancelled");

				const totalChunks = session.totalChunks;
				const chunkSize = session.chunkSize;
				const totalBytes = Number(session.totalSize);

				// Initialise progress state with whatever the server already has.
				emit({
					status: "uploading",
					progress: {
						totalChunks,
						receivedChunks: [...session.receivedChunks],
						bytesUploaded: computePercent(
							session.receivedChunks,
							chunkSize,
							totalBytes,
						) > 0
							? session.receivedChunks.reduce(
									(acc, idx) => acc + Math.min(chunkSize, Math.max(0, totalBytes - idx * chunkSize)),
									0,
								)
							: 0,
						totalBytes,
						percent: computePercent(session.receivedChunks, chunkSize, totalBytes),
						resumed,
						skipped,
					},
					error: null,
				});

				const receivedSet = new Set(session.receivedChunks);
				const todo: number[] = [];
				for (let i = 0; i < totalChunks; i++) {
					if (!receivedSet.has(i)) todo.push(i);
				}

				// Worker pool: up to MAX_CONCURRENT_CHUNKS PUTs in flight at once.
				let cursor = 0;
				const updateProgress = (view: MediaUploadSessionView) => {
					const received = view.receivedChunks;
					const bytes = received.reduce(
						(acc, idx) => acc + Math.min(chunkSize, Math.max(0, totalBytes - idx * chunkSize)),
						0,
					);
					emit({
						status: "uploading",
						progress: {
							totalChunks,
							receivedChunks: [...received],
							bytesUploaded: bytes,
							totalBytes,
							percent: Math.min(100, Math.round((bytes / totalBytes) * 100)),
							resumed,
							skipped,
						},
						error: null,
					});
				};

				const runWorker = async (): Promise<void> => {
					while (cursor < todo.length) {
						if (cancelledRef.current) throw new Error("cancelled");
						const idx = todo[cursor++]!;
						const start = idx * chunkSize;
						const end = Math.min(start + chunkSize, file.size);
						const slice = file.slice(start, end);
						const buf = await slice.arrayBuffer();
						const view = await putChunk(session.id, idx, buf.byteLength, buf);
						updateProgress(view);
					}
				};

				const workerCount = Math.min(MAX_CONCURRENT_CHUNKS, todo.length);
				const workers: Promise<void>[] = [];
				for (let w = 0; w < workerCount; w++) workers.push(runWorker());
				await Promise.all(workers);

				if (cancelledRef.current) throw new Error("cancelled");

				emit({ status: "completing", progress: state.progress, error: null });
				const complete = await csrfFetch<{
					session: MediaUploadSessionView;
					image: { id: string; publicUrl: string };
				}>(`/api/images/upload/${encodeURIComponent(session.id)}/complete`, {
					method: "POST",
				});
				clearPersistedSession(file);
				emit({
					status: "success",
					progress: {
						totalChunks,
						receivedChunks: complete.session.receivedChunks,
						bytesUploaded: totalBytes,
						totalBytes,
						percent: 100,
						resumed,
						skipped,
					},
					error: null,
				});
				return complete;
			} catch (err) {
				// Keep localStorage session fingerprint on transient failures so
				// the next upload of the same file can resume server-side chunks.
				// Only clear on success (above) or when init intentionally discards
				// an unusable persisted session.
				const message = err instanceof Error ? err.message : String(err);
				emit({
					status: "error",
					progress: state.progress,
					error: message === "cancelled" ? "cancelled" : message,
				});
				throw err;
			}
		},
		[emit, relativePath, state.progress, storageNodeId],
	);

	return { ...state, upload, reset };
}
