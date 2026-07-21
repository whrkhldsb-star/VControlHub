/**
 * Image processing service using sharp.
 * Provides thumbnail generation, format conversion (WebP/AVIF), and metadata extraction.
 */
import sharp from "sharp";
import * as path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

export interface ImageMetadata {
	width: number;
	height: number;
	format?: string;
	sizeBytes: number;
}

export interface ProcessedImage {
	thumbnail: Buffer;
	webp: Buffer | null;
	avif: Buffer | null;
	metadata: ImageMetadata;
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
 * Full image processing pipeline: thumbnail + WebP + AVIF + metadata.
 * Returns null for webp/avif if the input is already in that format.
 */
export async function processImage(buffer: Buffer): Promise<ProcessedImage> {
	const metadata = await extractMetadata(buffer);
	const [thumbnail, webp, avif] = await Promise.all([
		generateThumbnail(buffer),
		metadata.format !== "webp" ? convertToWebP(buffer) : Promise.resolve(null as Buffer | null),
		metadata.format !== "avif" ? convertToAVIF(buffer) : Promise.resolve(null as Buffer | null),
	]);

	return { thumbnail, webp, avif, metadata };
}

/**
 * Save processed image variants to disk.
 * Returns the paths of all saved files.
 */
export async function saveImageVariants(
	storageKey: string,
	original: Buffer,
	thumbnail: Buffer,
	webp: Buffer | null,
	avif: Buffer | null,
	baseDir: string,
): Promise<{
	originalPath: string;
	thumbnailPath: string;
	webpPath: string | null;
	avifPath: string | null;
}> {
	const dir = path.join(baseDir, path.dirname(storageKey));
	await mkdir(dir, { recursive: true });

	const ext = path.extname(storageKey);
	const base = path.basename(storageKey, ext);
	const subDir = path.dirname(storageKey);

	const originalPath = path.join(baseDir, storageKey);
	const thumbnailPath = path.join(baseDir, subDir, `${base}_thumb.webp`);
	const webpPath = webp ? path.join(baseDir, subDir, `${base}.webp`) : null;
	const avifPath = avif ? path.join(baseDir, subDir, `${base}.avif`) : null;

	await Promise.all([
		writeFile(originalPath, original),
		writeFile(thumbnailPath, thumbnail),
		webpPath && webp ? writeFile(webpPath, webp) : Promise.resolve(),
		avifPath && avif ? writeFile(avifPath, avif) : Promise.resolve(),
	]);

	return { originalPath, thumbnailPath, webpPath, avifPath };
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
