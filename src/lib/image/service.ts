/**
 * Image processing service using sharp.
 * Provides thumbnail generation, format conversion (WebP/AVIF), and metadata extraction.
 */
import sharp from "sharp";
import * as path from "node:path";

export interface ImageMetadata {
	width: number;
	height: number;
	format?: string;
	sizeBytes: number;
}

const THUMB_MAX_WIDTH = 400;
const THUMB_MAX_HEIGHT = 300;
const THUMB_QUALITY = 80;
const WEBP_QUALITY = 80;
const AVIF_QUALITY = 65;

/**
 * Hard pixel-count ceiling for any image we decode. Guards against
 * decompression bombs: a tiny, highly-compressed file (well under the 20 MB
 * byte cap) can still decode to a gigapixel bitmap, and we run sharp on it up
 * to four times (metadata + thumb + webp + avif). sharp's built-in default is
 * ~268 MP — far too high once multiplied by four in-flight decodes. 50 MP
 * still admits legitimate high-resolution photography (e.g. 8000×6000 ≈ 48 MP).
 */
export const MAX_IMAGE_PIXELS = 50_000_000;

/** Open a buffer with the shared pixel-limit guard applied. */
function openImage(buffer: Buffer) {
	return sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS });
}

/**
 * Canonical `image/*` MIME derived from sharp's byte-sniffed format, NOT from
 * the client-supplied Content-Type. Callers persist/serve this so a spoofed
 * upload header can never dictate the stored MIME. sharp format tokens are a
 * fixed lowercase set, so `image/<token>` is always a valid subtype.
 */
export function canonicalImageMime(format: string | undefined): string {
	if (!format) return "application/octet-stream";
	if (format === "svg") return "image/svg+xml";
	return `image/${format}`;
}

/**
 * Extract image metadata without full processing.
 */
export async function extractMetadata(buffer: Buffer): Promise<ImageMetadata> {
	const meta = await openImage(buffer).metadata();
	return {
		width: meta.width ?? 0,
		height: meta.height ?? 0,
		format: meta.format ?? undefined,
		sizeBytes: buffer.length,
	};
}

/**
 * Generate a thumbnail from an image buffer.
 */
export async function generateThumbnail(
	buffer: Buffer,
	options?: { maxWidth?: number; maxHeight?: number; quality?: number },
): Promise<Buffer> {
	const maxWidth = options?.maxWidth ?? THUMB_MAX_WIDTH;
	const maxHeight = options?.maxHeight ?? THUMB_MAX_HEIGHT;
	const quality = options?.quality ?? THUMB_QUALITY;

	return openImage(buffer)
		.resize(maxWidth, maxHeight, { fit: "inside", withoutEnlargement: true })
		.webp({ quality })
		.toBuffer();
}

/**
 * Convert image buffer to WebP format.
 */
export async function convertToWebP(
	buffer: Buffer,
	quality: number = WEBP_QUALITY,
): Promise<Buffer> {
	return openImage(buffer).webp({ quality }).toBuffer();
}

/**
 * Convert image buffer to AVIF format.
 */
export async function convertToAVIF(
	buffer: Buffer,
	quality: number = AVIF_QUALITY,
): Promise<Buffer> {
	return openImage(buffer).avif({ quality }).toBuffer();
}

/**
 * Delete image variants from disk.
 */
export async function deleteImageVariants(
	storageKey: string,
	baseDir: string,
): Promise<void> {
	const { unlink } = await import("node:fs/promises");
	const ext = path.extname(storageKey);
	const base = path.basename(storageKey, ext);
	const subDir = path.dirname(storageKey);

	const files = [
		path.join(baseDir, storageKey),
		path.join(baseDir, subDir, `${base}_thumb.webp`),
		path.join(baseDir, subDir, `${base}.webp`),
		path.join(baseDir, subDir, `${base}.avif`),
	];

	const failures: string[] = [];
	await Promise.all(files.map(async (file) => {
		try {
			await unlink(file);
		} catch (error) {
			if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
			failures.push(file);
		}
	}));
	if (failures.length > 0) {
		throw new Error(`Failed to delete ${failures.length} image variant(s): ${failures.join(", ")}`);
	}
}
