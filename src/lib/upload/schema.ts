/**
 * TR-009 55c: Media resumable upload — zod schemas.
 *
 * Validation lives here (not in the route handler) so the service layer
 * can re-use the same shape for any direct programmatic call.
 */
import { z } from "zod";

import {
	ALLOWED_MIME_PREFIXES,
	DEFAULT_CHUNK_SIZE,
	MAX_CHUNK_SIZE,
	MAX_TOTAL_SIZE,
	MIN_CHUNK_SIZE,
	STORAGE_ALLOWED_MIME_PATTERN,
} from "./types";

const allowedMimePrefixSchema = z
	.string()
	.min(1, "mimeType is required")
	.max(128)
	.refine(
		(m) => ALLOWED_MIME_PREFIXES.some((p) => m.startsWith(p)),
		{ message: "Only image/* MIME types are supported" },
	);

const storageMimeSchema = z
	.string()
	.min(1, "mimeType is required")
	.max(128)
	.refine(
		(m) => STORAGE_ALLOWED_MIME_PATTERN.test(m) || m === "application/octet-stream",
		{ message: "mimeType must be a valid type/subtype" },
	);

const filenameSchema = z
	.string()
	.min(1, "filename is required")
	.max(256, "filename cannot exceed 256 characters")
	.refine((f) => !f.includes("/") && !f.includes("\\"), {
		message: "filename must not contain path separators",
	});

const totalSizeSchema = z
	.number()
	.int("totalSize must be an integer")
	.min(1, "totalSize must be > 0")
	.max(MAX_TOTAL_SIZE, `totalSize cannot exceed ${MAX_TOTAL_SIZE} bytes`);

const chunkSizeSchema = z
	.number()
	.int("chunkSize must be an integer")
	.min(MIN_CHUNK_SIZE, `chunkSize cannot be less than ${MIN_CHUNK_SIZE} bytes`)
	.max(MAX_CHUNK_SIZE, `chunkSize cannot exceed ${MAX_CHUNK_SIZE} bytes`)
	.optional();

/** Body for POST /api/images/upload/init. */
export const initMediaUploadSchema = z.object({
	filename: filenameSchema,
	mimeType: allowedMimePrefixSchema,
	totalSize: totalSizeSchema,
	chunkSize: chunkSizeSchema,
	storageNodeId: z.string().min(1).max(64).optional(),
	relativePath: z
		.string()
		.max(512, "relativePath cannot exceed 512 characters")
		.optional(),
});

/** Body for POST /api/storage/upload/init — ordinary file manager uploads. */
export const initStorageUploadSchema = z.object({
	filename: filenameSchema,
	mimeType: storageMimeSchema,
	totalSize: totalSizeSchema,
	chunkSize: chunkSizeSchema,
	storageNodeId: z.string().min(1).max(64),
	/** Full relative path of the target file (including filename). */
	relativePath: z
		.string()
		.min(1, "relativePath is required")
		.max(512, "relativePath cannot exceed 512 characters"),
});

/** Per-chunk metadata (sent in query or body, depending on route shape).
 *  `z.coerce.number()` because the route parses query params as strings
 *  (`withApiRoute`'s querySchema paths route through URLSearchParams). */
export const appendMediaChunkSchema = z.object({
	/** Zero-based index of the chunk within the file. */
	index: z.coerce
		.number()
		.int("chunk.index must be an integer")
		.min(0, "chunk.index cannot be negative"),
	/** Total size of THIS chunk in bytes. Used to verify the upload
	 *  matches the expected chunk size. */
	size: z.coerce
		.number()
		.int("chunk.size must be an integer")
		.min(1, "chunk.size must be > 0")
		.max(MAX_CHUNK_SIZE, `chunk.size cannot exceed ${MAX_CHUNK_SIZE} bytes`),
});

/** Default export so the route can `import { initMediaUploadSchema } from "./schema"`. */
export const DEFAULT_UPLOAD_CHUNK_SIZE = DEFAULT_CHUNK_SIZE;
