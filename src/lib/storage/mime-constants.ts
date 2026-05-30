/**
 * Shared MIME-type constants for the storage / file modules.
 * Single source of truth — all consumers import from here.
 */

/* ── Office documents ──────────────────────────────────────── */
export const OFFICE_MIME_TYPES: string[] = [
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/msword",
	"application/vnd.ms-excel",
	"application/vnd.ms-powerpoint",
]

export const OFFICE_MIME_SET = new Set<string>(OFFICE_MIME_TYPES);

/* ── Archives ──────────────────────────────────────────────── */
export const ARCHIVE_MIME_TYPES: string[] = [
	"application/zip",
	"application/x-zip-compressed",
	"application/x-rar-compressed",
	"application/x-7z-compressed",
	"application/gzip",
	"application/x-tar",
	"application/java-archive",
	"application/x-bzip2",
	"application/x-xz",
]

export const ARCHIVE_MIME_SET = new Set<string>(ARCHIVE_MIME_TYPES);

/* ── CSV / TSV ─────────────────────────────────────────────── */
export const CSV_MIME_TYPES: string[] = [
	"text/csv",
	"application/csv",
	"text/tab-separated-values",
]

export const CSV_MIME_SET = new Set<string>(CSV_MIME_TYPES);

/* ── Markdown ──────────────────────────────────────────────── */
export const MARKDOWN_MIME_TYPES: string[] = [
	"text/markdown",
	"text/x-markdown",
];

export const MARKDOWN_MIME_SET = new Set<string>(MARKDOWN_MIME_TYPES);

/* ── Extended text (JSON, XML, JS, etc.) ───────────────────── */
export const EXTENDED_TEXT_MIME_TYPES: string[] = [
	"application/json",
	"application/ld+json",
	"application/xml",
	"application/javascript",
	"application/x-javascript",
	"text/xml",
	"text/javascript",
	"application/x-yaml",
	"text/yaml",
	"text/x-yaml",
	"application/toml",
	"application/x-sh",
	"text/x-shellscript",
	"text/x-python",
	"text/x-ruby",
	"text/x-perl",
	"text/x-php",
	"application/x-httpd-php",
	"text/x-c",
	"text/x-c++",
	"text/x-java-source",
	"text/x-go",
	"text/x-rust",
	"application/x-dockerfile",
	"text/x-dockerfile",
	"application/x-gitignore",
]

export const EXTENDED_TEXT_MIME_SET = new Set<string>(EXTENDED_TEXT_MIME_TYPES);

/* ── Image ─────────────────────────────────────────────────── */
export const IMAGE_MIME_SET = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
	"image/svg+xml",
	"image/bmp",
	"image/avif",
	"image/tiff",
	"image/x-icon",
]);

/* ── Audio ─────────────────────────────────────────────────── */
export const AUDIO_MIME_SET = new Set([
	"audio/mpeg",
	"audio/ogg",
	"audio/wav",
	"audio/flac",
	"audio/aac",
	"audio/mp4",
	"audio/webm",
]);

/* ── Video ─────────────────────────────────────────────────── */
export const VIDEO_MIME_SET = new Set([
	"video/mp4",
	"video/webm",
	"video/ogg",
	"video/x-matroska",
	"video/quicktime",
	"video/x-msvideo",
]);

/* ── Composite helpers ─────────────────────────────────────── */

/** Is the MIME type previewable as a document (office / archive / csv / markdown / text / code)? */
export function isDocumentMime(mime: string): boolean {
	return (
		OFFICE_MIME_SET.has(mime) ||
		ARCHIVE_MIME_SET.has(mime) ||
		CSV_MIME_SET.has(mime) ||
		MARKDOWN_MIME_SET.has(mime) ||
		EXTENDED_TEXT_MIME_SET.has(mime) ||
		mime.startsWith("text/")
	);
}

/** Is the MIME type a media file (image / audio / video)? */
export function isMediaMime(mime: string): boolean {
	return IMAGE_MIME_SET.has(mime) || AUDIO_MIME_SET.has(mime) || VIDEO_MIME_SET.has(mime);
}

/** Is the MIME type of an editable text file (code, config, data)? */
export const EDITABLE_TEXT_MIME_PREFIXES = ["text/"];

export const EDITABLE_TEXT_MIME_TYPES = new Set([
	"application/json",
	"application/ld+json",
	"application/xml",
	"application/javascript",
	"application/x-javascript",
	"application/x-sh",
	"image/svg+xml",
]);

export const EDITABLE_TEXT_EXTENSIONS = new Set([
	".txt", ".md", ".json", ".js", ".jsx", ".ts", ".tsx",
	".css", ".scss", ".html", ".xml", ".yml", ".yaml",
	".csv", ".log", ".env", ".py", ".sh", ".svg",
]);

export const MAX_EDITABLE_FILE_SIZE_BYTES = 512 * 1024;

export const MAX_INLINE_REMOTE_READ_BYTES = 1024 * 1024;

export const MAX_STORAGE_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Is the file previewable in the browser? */
export function isPreviewableMime(mime: string | null | undefined): boolean {
	if (!mime) return false;
	return (
		mime === "application/pdf" ||
		isMediaMime(mime) ||
		isDocumentMime(mime)
	);
}
