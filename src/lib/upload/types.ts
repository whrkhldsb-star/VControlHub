/**
 * TR-009 55c: Media resumable upload — types.
 *
 * Lifecycle of a MediaUploadSession:
 *   PENDING (init) → UPLOADING (first chunk) → COMPLETED (assemble ok)
 *   any state      → CANCELLED (client / server TTL)
 *   any state      → FAILED (assembly error)
 *
 * Chunk storage lives in /tmp under UPLOAD_TMP_DIR/<sessionId>/chunk-N.
 * On COMPLETED, chunks are concatenated into the final image buffer and
 * handed off to the existing image pipeline; on CANCELLED/expired, the temp
 * dir is removed.
 */

/** Default chunk size (5 MiB). Small enough for fast resume, large enough to
 *  keep HTTP overhead < 5% for a 100MB upload. */
export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

/** Hard cap on total upload size: 200 MiB. Above this we require the
 *  admin to use direct storage node upload instead. */
export const MAX_TOTAL_SIZE = 200 * 1024 * 1024;

/** Hard cap on individual chunk size: 20 MiB. Larger chunks would
 *  exceed our request body limits. */
export const MAX_CHUNK_SIZE = 20 * 1024 * 1024;

/** Hard floor on chunk size: 64 KiB. Smaller chunks thrash the
 *  filesystem. */
export const MIN_CHUNK_SIZE = 64 * 1024;

/** Allowed MIME prefixes for chunked media upload. Image only (per
 *  existing /api/images/upload behaviour). */
export const ALLOWED_MIME_PREFIXES = ["image/"] as const;

/** Storage file resumable uploads accept any non-empty MIME (or
 *  application/octet-stream fallback). */
export const STORAGE_ALLOWED_MIME_PATTERN = /^[\w.+-]+\/[\w.+-]+$/;

/** Default TTL for a session: 24h from init. Sweeper removes expired
 *  sessions + their temp dir. */
export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Effective shape of a session for client consumption. Internal-only
 *  fields (e.g. raw `receivedChunks` array) are summarised. */
export interface MediaUploadSessionView {
	id: string;
	filename: string;
	mimeType: string;
	totalSize: number;
	chunkSize: number;
	totalChunks: number;
	/** Indices that have been received (sorted ascending, deduped). */
	receivedChunks: number[];
	/** Indices still missing. */
	missingChunks: number[];
	storageNodeId: string | null;
	relativePath: string | null;
	status:
		| "PENDING"
		| "UPLOADING"
		| "COMPLETED"
		| "CANCELLED"
		| "FAILED";
	resultImageId: string | null;
	checksum: string | null;
	errorMessage: string | null;
	completedAt: string | null;
	expiresAt: string; // ISO 8601
	createdAt: string;
	updatedAt: string;
}

/** Input for `initMediaUploadSession`. */
export interface InitMediaUploadInput {
	userId: string;
	filename: string;
	mimeType: string;
	totalSize: number;
	chunkSize?: number;
	storageNodeId?: string;
	relativePath?: string;
	ttlMs?: number;
}
