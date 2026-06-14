import * as path from "node:path";

import { config } from "@/lib/config/env";

function resolveUploadDir() {
	if (config.storage.imageUploadDir) return config.storage.imageUploadDir;
	const appDir = config.app.appDir?.trim() || "/opt/whrkhldsb";
	return path.join(appDir, "uploads", "image-bed");
}

/** Directory where uploaded image files are stored on disk. */
export const UPLOAD_DIR = resolveUploadDir();

/** Recognized image file extensions (lowercase, with leading dot). */
export const IMAGE_EXTENSIONS = new Set([
	".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif",
	".svg", ".bmp", ".ico", ".tiff",
]);

/* ------------------------------------------------------------------ */
/* MIME type inference from file extension                             */
/* ------------------------------------------------------------------ */

const EXTENSION_MIME_MAP: Record<string, string> = {
	// Images
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg": "image/svg+xml",
	".bmp": "image/bmp",
	".ico": "image/x-icon",
	".tiff": "image/tiff",
	// Text / markup
	".txt": "text/plain",
	".md": "text/markdown",
	".html": "text/html",
	".htm": "text/html",
	".css": "text/css",
	// Script / code
	".js": "application/javascript",
	".mjs": "application/javascript",
	".ts": "application/typescript",
	".tsx": "application/typescript",
	".jsx": "application/javascript",
	// Data formats
	".json": "application/json",
	".xml": "application/xml",
	".yaml": "application/x-yaml",
	".yml": "application/x-yaml",
	".csv": "text/csv",
	// Documents
	".pdf": "application/pdf",
	// Archives
	".zip": "application/zip",
	".tar": "application/x-tar",
	".gz": "application/gzip",
	".7z": "application/x-7z-compressed",
	".rar": "application/vnd.rar",
	// Video
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mkv": "video/x-matroska",
	".avi": "video/x-msvideo",
	".mov": "video/quicktime",
	// Audio
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".flac": "audio/flac",
	".aac": "audio/aac",
	// Programming languages
	".sh": "application/x-sh",
	".py": "text/x-python",
	".rb": "text/x-ruby",
	".java": "text/x-java-source",
	".c": "text/x-c",
	".cpp": "text/x-c++src",
	".h": "text/x-c",
	".go": "text/x-go",
	".rs": "text/x-rust",
	".php": "text/x-php",
	// Config / log
	".log": "text/plain",
	".env": "text/plain",
	".conf": "text/plain",
	".ini": "text/plain",
	".toml": "text/x-toml",
	// Database
	".sql": "application/sql",
	".db": "application/x-sqlite3",
	// Binaries
	".exe": "application/x-msdownload",
	".dll": "application/x-msdownload",
	".so": "application/x-sharedlib",
};

/**
 * Return the MIME type for a file extension (with leading dot, e.g. `".png"`).
 * Falls back to `"application/octet-stream"` for unknown extensions.
 */
export function mimeTypeFromExt(ext: string): string {
	return EXTENSION_MIME_MAP[ext.toLowerCase()] ?? "application/octet-stream";
}

/**
 * Guess the MIME type from a full file name (e.g. `"photo.png"`).
 * Returns `null` if the file name has no extension.
 */
export function guessMimeType(fileName: string): string | null {
	const lastDot = fileName.lastIndexOf(".");
	if (lastDot === -1) return null;
	const ext = fileName.slice(lastDot).toLowerCase();
	return EXTENSION_MIME_MAP[ext] ?? null;
}
