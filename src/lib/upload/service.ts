/**
 * TR-009 55c: Media resumable upload — service.
 *
 * Manages MediaUploadSession lifecycle: init / get / append chunk /
 * complete / cancel / sweep expired. Chunks live in /tmp under
 * UPLOAD_TMP_DIR/<sessionId>/chunk-N.
 *
 * Image processing (sharp / thumbnail / webp / avif + ImageUpload row
 * creation) is the API route's job — this service exposes
 * `assembleMediaUploadChunks()` to give the route the assembled Buffer,
 * and `completeMediaUploadSession()` to flip status to COMPLETED.
 */
import * as crypto from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import * as path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";

import {
	DEFAULT_CHUNK_SIZE,
	DEFAULT_SESSION_TTL_MS,
	MAX_TOTAL_SIZE,
	type InitMediaUploadInput,
	type MediaUploadSessionView,
} from "./types";

/** Where chunk files are kept between init and complete. */
export const UPLOAD_TMP_DIR =
	process.env.MEDIA_UPLOAD_TMP_DIR ||
	path.join("/tmp", "vcontrolhub-media-uploads");

class MediaUploadError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
		this.name = "MediaUploadError";
	}
}

function sessionDir(sessionId: string): string {
	return path.join(UPLOAD_TMP_DIR, sessionId);
}

function chunkPath(sessionId: string, index: number): string {
	return path.join(sessionDir(sessionId), `chunk-${index}`);
}

function ttlExpiry(ttlMs: number): Date {
	return new Date(Date.now() + ttlMs);
}

/** Convert a Prisma row to the public view shape, computing missingChunks. */
function toView(row: {
	id: string;
	filename: string;
	mimeType: string;
	totalSize: bigint;
	chunkSize: number;
	totalChunks: number;
	receivedChunks: number[];
	storageNodeId: string | null;
	relativePath: string | null;
	status: string;
	resultImageId: string | null;
	checksum: string | null;
	errorMessage: string | null;
	expiresAt: Date;
	completedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}): MediaUploadSessionView {
	const received = [...row.receivedChunks].sort((a, b) => a - b);
	const missing: number[] = [];
	for (let i = 0; i < row.totalChunks; i++) {
		if (!received.includes(i)) missing.push(i);
	}
	return {
		id: row.id,
		filename: row.filename,
		mimeType: row.mimeType,
		totalSize: Number(row.totalSize),
		chunkSize: row.chunkSize,
		totalChunks: row.totalChunks,
		receivedChunks: received,
		missingChunks: missing,
		storageNodeId: row.storageNodeId,
		relativePath: row.relativePath,
		status: row.status as MediaUploadSessionView["status"],
		resultImageId: row.resultImageId,
		checksum: row.checksum,
		errorMessage: row.errorMessage,
		completedAt: row.completedAt ? row.completedAt.toISOString() : null,
		expiresAt: row.expiresAt.toISOString(),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

/** Initialise a new upload session. */
export async function initMediaUploadSession(
	input: InitMediaUploadInput,
): Promise<MediaUploadSessionView> {
	const chunkSize = input.chunkSize ?? DEFAULT_CHUNK_SIZE;
	if (input.totalSize > MAX_TOTAL_SIZE) {
		throw new MediaUploadError(
			"total_size_too_large",
			`totalSize ${input.totalSize} exceeds limit ${MAX_TOTAL_SIZE}`,
		);
	}
	const totalChunks = Math.max(1, Math.ceil(input.totalSize / chunkSize));
	const expiresAt = ttlExpiry(input.ttlMs ?? DEFAULT_SESSION_TTL_MS);

	const row = await prisma.mediaUploadSession.create({
		data: {
			userId: input.userId,
			filename: input.filename,
			mimeType: input.mimeType,
			totalSize: BigInt(input.totalSize),
			chunkSize,
			totalChunks,
			receivedChunks: [],
			storageNodeId: input.storageNodeId ?? null,
			relativePath: input.relativePath ?? null,
			status: "PENDING",
			expiresAt,
		},
	});

	// Create temp dir eagerly so the first chunk can be appended without
	// an extra round trip. Best-effort: failure to mkdir does not block
	// the session — append will retry.
	await mkdir(sessionDir(row.id), { recursive: true }).catch((err) => {
		logError("media-upload:mkdir-failed", err);
	});

	return toView(row);
}

/** Fetch a session, scoped to the user. Returns null if not found. */
export async function getMediaUploadSession(
	sessionId: string,
	userId: string,
): Promise<MediaUploadSessionView | null> {
	const row = await prisma.mediaUploadSession.findFirst({
		where: { id: sessionId, userId },
	});
	if (!row) return null;
	return toView(row);
}

/** Append a chunk. Idempotent on (sessionId, index) — re-uploading the
 *  same index overwrites. Auto-transitions PENDING → UPLOADING on first
 *  chunk. */
export async function appendMediaUploadChunk(params: {
	sessionId: string;
	userId: string;
	index: number;
	size: number;
	buffer: Buffer;
}): Promise<MediaUploadSessionView> {
	const { sessionId, userId, index, size, buffer } = params;
	if (index < 0) {
		throw new MediaUploadError("chunk_index_invalid", "index cannot be negative");
	}
	if (buffer.byteLength !== size) {
		throw new MediaUploadError(
			"chunk_size_mismatch",
			`chunk size ${buffer.byteLength} does not match declared ${size}`,
		);
	}

	const existing = await prisma.mediaUploadSession.findFirst({
		where: { id: sessionId, userId },
	});
	if (!existing) {
		throw new MediaUploadError("session_not_found", "Upload session not found");
	}
	if (existing.status === "COMPLETED") {
		throw new MediaUploadError("session_completed", "Session already completed, cannot append");
	}
	if (existing.status === "CANCELLED" || existing.status === "FAILED") {
		throw new MediaUploadError(
			`session_${existing.status.toLowerCase()}`,
			`Session already ${existing.status}`,
		);
	}
	if (existing.expiresAt.getTime() < Date.now()) {
		throw new MediaUploadError("session_expired", "Session has expired");
	}
	if (index >= existing.totalChunks) {
		throw new MediaUploadError(
			"chunk_index_out_of_range",
			`index ${index} exceeds totalChunks ${existing.totalChunks}`,
		);
	}

	// Write chunk file (overwrites if duplicate)
	await mkdir(sessionDir(sessionId), { recursive: true });
	await writeFile(chunkPath(sessionId, index), buffer);

	// Update receivedChunks: dedupe + sort in app code (Prisma array
	// push is a no-op for dups; we manage the set ourselves).
	const nextReceived = Array.from(new Set([...existing.receivedChunks, index])).sort(
		(a, b) => a - b,
	);

	const row = await prisma.mediaUploadSession.update({
		where: { id: sessionId },
		data: {
			receivedChunks: nextReceived,
			status: existing.status === "PENDING" ? "UPLOADING" : existing.status,
		},
	});
	return toView(row);
}

/** Assemble chunks into a single Buffer. Reads chunk-0..chunk-(N-1) in
 *  order. Throws if any chunk is missing. Does NOT mutate session state
 *  — caller decides when to flip to COMPLETED. */
export async function assembleMediaUploadChunks(
	sessionId: string,
	userId: string,
): Promise<Buffer> {
	const row = await prisma.mediaUploadSession.findFirst({
		where: { id: sessionId, userId },
	});
	if (!row) {
		throw new MediaUploadError("session_not_found", "Upload session not found");
	}
	if (row.receivedChunks.length !== row.totalChunks) {
		const missing: number[] = [];
		for (let i = 0; i < row.totalChunks; i++) {
			if (!row.receivedChunks.includes(i)) missing.push(i);
		}
		throw new MediaUploadError(
			"chunks_incomplete",
			`Missing ${missing.length} chunk(s): ${missing.slice(0, 5).join(",")}${missing.length > 5 ? "..." : ""}`,
		);
	}

	// Read chunks in order. Sequential reads avoid loading the whole
	// file twice; for 200MB cap, total is well within 1GB of process RSS.
	const buffers: Buffer[] = [];
	for (let i = 0; i < row.totalChunks; i++) {
		const buf = await readFile(chunkPath(sessionId, i));
		buffers.push(buf);
	}
	return Buffer.concat(buffers);
}

/** Mark a session COMPLETED. Computes sha256 of the assembled buffer.
 *  Caller passes the buffer (already assembled) to avoid re-reading.
 *  Uses updateMany with userId in where for atomic ownership check. */
export async function completeMediaUploadSession(params: {
	sessionId: string;
	userId: string;
	buffer: Buffer;
	resultImageId?: string;
}): Promise<MediaUploadSessionView> {
	const { sessionId, userId, buffer, resultImageId } = params;
	const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
	const updateResult = await prisma.mediaUploadSession.updateMany({
		where: { id: sessionId, userId },
		data: {
			status: "COMPLETED",
			checksum,
			resultImageId: resultImageId ?? null,
			completedAt: new Date(),
		},
	});
	if (updateResult.count === 0) {
		throw new MediaUploadError("session_not_found", "Upload session not found or does not belong to the current user");
	}
	const row = await prisma.mediaUploadSession.findUniqueOrThrow({
		where: { id: sessionId },
	});
	// Cleanup temp dir best-effort
	await cleanupMediaUploadTempDir(sessionId).catch((err) => {
		logError("media-upload:cleanup-failed", err);
	});
	return toView(row);
}

/** Cancel a session. Cleans up the temp dir. */
export async function cancelMediaUploadSession(
	sessionId: string,
	userId: string,
): Promise<MediaUploadSessionView> {
	const updateResult = await prisma.mediaUploadSession.updateMany({
		where: { id: sessionId, userId },
		data: { status: "CANCELLED" },
	});
	if (updateResult.count === 0) {
		throw new MediaUploadError("session_not_found", "Upload session not found or does not belong to the current user");
	}
	const row = await prisma.mediaUploadSession.findUniqueOrThrow({
		where: { id: sessionId },
	});
	await cleanupMediaUploadTempDir(sessionId).catch((err) => {
		logError("media-upload:cleanup-failed", err);
	});
	return toView(row);
}

/** Remove a session's temp dir. Idempotent. */
export async function cleanupMediaUploadTempDir(
	sessionId: string,
): Promise<void> {
	await rm(sessionDir(sessionId), { recursive: true, force: true });
}

/** Sweep expired sessions + their temp dirs. Returns number cleaned. */
export async function sweepExpiredMediaUploadSessions(): Promise<number> {
	const now = new Date();
	const expired = await prisma.mediaUploadSession.findMany({
		where: {
			expiresAt: { lt: now },
			status: { in: ["PENDING", "UPLOADING"] },
		},
		select: { id: true },
		take: 1000, // P2: 单 sweep 过期 session 数,>1k 即异常
	});
	for (const row of expired) {
		await cleanupMediaUploadTempDir(row.id).catch(() => undefined);
	}
	if (expired.length > 0) {
		await prisma.mediaUploadSession.updateMany({
			where: { id: { in: expired.map((r) => r.id) } },
			data: { status: "CANCELLED" },
		});
	}
	return expired.length;
}

/** Read chunk files in a session temp dir. Test helper. */
export async function readSessionTempDir(sessionId: string): Promise<string[]> {
	try {
		return (await readdir(sessionDir(sessionId))).sort();
	} catch (err) {
		if (
			err instanceof Error &&
			"code" in err &&
			(err as NodeJS.ErrnoException).code === "ENOENT"
		) {
			return [];
		}
		throw err;
	}
}

/** Re-export the error class + Prisma namespace for tests / routes. */
export { MediaUploadError, Prisma };
