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
 * Extract image metadata without full processing.
 */
export async function extractMetadata(buffer: Buffer): Promise<ImageMetadata> {
	const meta = await sharp(buffer).metadata();
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

	return sharp(buffer)
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
	return sharp(buffer).webp({ quality }).toBuffer();
}

/**
 * Convert image buffer to AVIF format.
 */
export async function convertToAVIF(
	buffer: Buffer,
	quality: number = AVIF_QUALITY,
): Promise<Buffer> {
	return sharp(buffer).avif({ quality }).toBuffer();
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
