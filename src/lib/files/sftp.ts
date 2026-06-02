export type SftpListEntryType = "file" | "directory" | "other";

export function formatSftpFileSize(bytes: number | bigint | null | undefined): string {
  if (bytes == null) return "-";
  const size = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (!Number.isFinite(size) || size < 0) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatSftpTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function joinSftpPath(base: string, segment: string): string {
  if (!base || base === "/") return `/${segment.replace(/^\/+/, "")}`;
  const cleanBase = base.replace(/\/+$/, "");
  const cleanSegment = segment.replace(/^\/+/, "");
  return `${cleanBase}/${cleanSegment}`;
}

export function splitSftpPath(path: string) {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function getSftpEntryIcon(type: SftpListEntryType): string {
  switch (type) {
    case "directory":
      return "📁";
    case "file":
      return "📄";
    default:
      return "📎";
  }
}

const SFTP_PREVIEW_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  pdf: "application/pdf",
  csv: "text/csv",
  md: "text/markdown",
  mdx: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  sql: "application/sql",
};

function getSftpExtension(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower === "makefile" || lower === ".gitignore") return lower.replace(/^\./, "");
  return lower.includes(".") ? lower.split(".").pop() ?? "" : "";
}

export function getSftpPreviewMimeType(name: string): string | null {
  const lower = name.toLowerCase();
  if (isViewableSftpTextFile(lower)) return SFTP_PREVIEW_MIME_BY_EXTENSION[getSftpExtension(lower)] ?? "text/plain";
  return SFTP_PREVIEW_MIME_BY_EXTENSION[getSftpExtension(lower)] ?? null;
}

export function isPreviewableSftpFile(name: string): boolean {
  return getSftpPreviewMimeType(name) !== null;
}

export function buildSftpPreviewUrl(nodeId: string, remotePath: string, name: string): string {
  const href = buildSftpDownloadHref(nodeId, remotePath);
  const mimeType = getSftpPreviewMimeType(name) ?? "";
  const params = new URLSearchParams({
    href,
    name,
    type: mimeType,
    driver: "SFTP",
    nodeId,
    relativePath: remotePath,
  });
  return `/files/preview?${params.toString()}`;
}

export function buildSftpDownloadHref(nodeId: string, remotePath: string): string {
  const params = new URLSearchParams({ nodeId, path: remotePath });
  return `/api/storage/sftp-download?${params.toString()}`;
}

export function buildSftpDownloadUrl(nodeId: string, remotePath: string): string {
  return `${buildSftpDownloadHref(nodeId, remotePath)}&download=1`;
}

export function buildSftpDirectProxyUrl(input: {
  publicUrl: string;
  port: number;
  remotePath: string;
  accessToken: string;
}): string {
  const trimmedBase = input.publicUrl.trim();
  const base = trimmedBase || "http://localhost";
  const url = new URL(base.endsWith("/") ? base : `${base}/`);
  if (input.port > 0) {
    url.port = String(input.port);
  }
  url.pathname = input.remotePath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  if (!url.pathname.startsWith("/")) {
    url.pathname = `/${url.pathname}`;
  }
  url.searchParams.set("token", input.accessToken);
  return url.toString();
}

export function guessSftpFileIcon(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  if (!ext) return "📄";
  if (["jpg", "jpeg", "png", "webp", "gif", "svg", "bmp", "ico"].includes(ext)) return "🖼️";
  if (["mp4", "webm", "mkv", "avi", "mov"].includes(ext)) return "🎬";
  if (["mp3", "wav", "ogg", "flac", "aac"].includes(ext)) return "🎵";
  if (ext === "pdf") return "📄";
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext)) return "📦";
  return "📄";
}

const VIEWABLE_EXTENSIONS = new Set([
  "txt", "md", "json", "js", "jsx", "ts", "tsx", "css", "scss", "html", "htm",
  "xml", "yaml", "yml", "toml", "ini", "conf", "cfg", "env", "sh", "bash",
  "py", "rb", "go", "rs", "java", "c", "cpp", "h", "hpp", "php", "pl",
  "sql", "log", "csv", "vue", "svelte", "dockerfile", "gitignore",
  "makefile", "cmake", "gradle", "properties", "bat", "ps1",
]);

export function isViewableSftpTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (VIEWABLE_EXTENSIONS.has(lower)) return true;
  const ext = lower.includes(".") ? lower.split(".").pop() : "";
  return ext ? VIEWABLE_EXTENSIONS.has(ext) : false;
}
