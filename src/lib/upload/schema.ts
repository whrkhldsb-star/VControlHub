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
} from "./types";

const allowedMimePrefixSchema = z
	.string()
	.min(1, "mimeType 不能为空")
	.max(128)
	.refine(
		(m) => ALLOWED_MIME_PREFIXES.some((p) => m.startsWith(p)),
		{ message: "仅支持 image/* MIME 类型" },
	);

/** Body for POST /api/images/upload/init. */
export const initMediaUploadSchema = z.object({
	filename: z
		.string()
		.min(1, "filename 不能为空")
		.max(256, "filename 不能超过 256 字符")
		.refine((f) => !f.includes("/") && !f.includes("\\"), {
			message: "filename 不能包含路径分隔符",
		}),
	mimeType: allowedMimePrefixSchema,
	totalSize: z
		.number()
		.int("totalSize 必须为整数")
		.min(1, "totalSize 必须 > 0")
		.max(MAX_TOTAL_SIZE, `totalSize 不能超过 ${MAX_TOTAL_SIZE} 字节`),
	chunkSize: z
		.number()
		.int("chunkSize 必须为整数")
		.min(MIN_CHUNK_SIZE, `chunkSize 不能小于 ${MIN_CHUNK_SIZE} 字节`)
		.max(MAX_CHUNK_SIZE, `chunkSize 不能超过 ${MAX_CHUNK_SIZE} 字节`)
		.optional(),
	storageNodeId: z.string().min(1).max(64).optional(),
	relativePath: z
		.string()
		.max(512, "relativePath 不能超过 512 字符")
		.optional(),
});

/** Per-chunk metadata (sent in query or body, depending on route shape). */
export const appendMediaChunkSchema = z.object({
	/** Zero-based index of the chunk within the file. */
	index: z
		.number()
		.int("chunk.index 必须为整数")
		.min(0, "chunk.index 不能为负"),
	/** Total size of THIS chunk in bytes. Used to verify the upload
	 *  matches the expected chunk size. */
	size: z
		.number()
		.int("chunk.size 必须为整数")
		.min(1, "chunk.size 必须 > 0")
		.max(MAX_CHUNK_SIZE, `chunk.size 不能超过 ${MAX_CHUNK_SIZE} 字节`),
});

/** Default export so the route can `import { initMediaUploadSchema } from "./schema"`. */
export const DEFAULT_UPLOAD_CHUNK_SIZE = DEFAULT_CHUNK_SIZE;
