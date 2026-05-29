import {
  ARCHIVE_MIME_SET,
  CSV_MIME_SET,
  EXTENDED_TEXT_MIME_SET,
  MARKDOWN_MIME_SET,
  OFFICE_MIME_SET,
} from "@/lib/storage/mime-constants";

export type StorageEntry = {
  id: string;
  name: string;
  entryType: string;
  mimeType?: string | null;
  relativePath: string;
  sizeLabel: string;
  previewable: boolean;
  directAccess: { mode: string; href?: string; description: string };
  storageNode: { id: string; name: string; driver: string };
  updatedAt?: Date | string;
};

export type FileProp = {
  id: string;
  name: string;
  entryType: string;
  mimeType?: string | null;
  relativePath: string;
  sizeLabel: string;
  previewable: boolean;
  directAccessMode: string;
  directAccessHref?: string | null;
  directAccessDescription: string;
  storageNodeId: string;
  storageNodeName: string;
  storageNodeDriver: string;
  updatedAt?: string | null;
};

const EXTENDED_PREVIEW_MIMES = new Set([
  "image/svg+xml",
  "application/x-ndjson",
  "application/sql",
  "application/yaml",
  ...EXTENDED_TEXT_MIME_SET,
  ...CSV_MIME_SET,
  ...MARKDOWN_MIME_SET,
]);

export function buildSearchHref(path: string, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `/files?${qs}` : "/files";
}

export function buildProxyDownloadHref(entry: StorageEntry) {
  if (entry.storageNode.driver === "SFTP") {
    const params = new URLSearchParams({
      nodeId: entry.storageNode.id,
      path: entry.relativePath,
    });
    return `/api/storage/sftp-download?${params.toString()}`;
  }
  return `/api/storage/local?path=${encodeURIComponent(entry.relativePath)}`;
}

export function buildDirectDownloadHref(entry: StorageEntry) {
  if (
    entry.storageNode.driver === "SFTP" &&
    entry.directAccess.mode === "direct-url" &&
    entry.directAccess.href
  ) {
    return entry.directAccess.href;
  }
  return null;
}

export function appendDownloadFlag(href: string) {
  return `${href}${href.includes("?") ? "&" : "?"}download=1`;
}

export function buildDownloadHref(entry: StorageEntry) {
  return buildDirectDownloadHref(entry) ?? buildProxyDownloadHref(entry);
}

export function getPreviewHref(entry: StorageEntry) {
  const mime = entry.mimeType ?? "";
  const isPreviewableMime =
    mime.startsWith("video/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("image/") ||
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    OFFICE_MIME_SET.has(mime) ||
    ARCHIVE_MIME_SET.has(mime) ||
    EXTENDED_PREVIEW_MIMES.has(mime);
  if (isPreviewableMime) {
    const downloadHref =
      entry.directAccess.mode === "managed-download" && entry.directAccess.href
        ? entry.directAccess.href
        : buildDownloadHref(entry);
    const params = new URLSearchParams({
      href: downloadHref,
      name: entry.name,
      type: mime,
      driver: entry.storageNode.driver,
      ...(entry.storageNode.id ? { nodeId: entry.storageNode.id } : {}),
      ...(entry.relativePath ? { relativePath: entry.relativePath } : {}),
    });
    return `/files/preview?${params.toString()}`;
  }
  return entry.directAccess.mode === "managed-download" &&
    entry.directAccess.href
    ? entry.directAccess.href
    : buildDownloadHref(entry);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getThumbnailUrl(entry: StorageEntry): string | null {
  const mime = entry.mimeType ?? "";
  if (!mime.startsWith("image/")) return null;
  if (
    entry.directAccess.mode === "managed-download" &&
    entry.directAccess.href
  ) {
    return entry.directAccess.href;
  }
  return buildDownloadHref(entry);
}

export function toStorageEntry(file: FileProp): StorageEntry {
  return {
    id: file.id,
    name: file.name,
    entryType: file.entryType,
    mimeType: file.mimeType,
    relativePath: file.relativePath,
    sizeLabel: file.sizeLabel,
    previewable: file.previewable,
    directAccess: {
      mode: file.directAccessMode,
      href: file.directAccessHref ?? undefined,
      description: file.directAccessDescription,
    },
    storageNode: {
      id: file.storageNodeId,
      name: file.storageNodeName,
      driver: file.storageNodeDriver,
    },
    updatedAt: file.updatedAt ?? undefined,
  };
}
