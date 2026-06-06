import {
  ARCHIVE_MIME_SET,
  CSV_MIME_SET,
  EXTENDED_TEXT_MIME_SET,
  MARKDOWN_MIME_SET,
  OFFICE_MIME_SET,
} from "@/lib/storage/mime-constants";

export type EntryCapabilities = {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
};

export type StorageEntry = {
  id: string;
  name: string;
  entryType: string;
  mimeType?: string | null;
  relativePath: string;
  size?: bigint | number | null;
  sizeLabel: string;
  previewable: boolean;
  localEditable?: boolean;
  directAccess: { mode: string; href?: string; description: string };
  storageNode: { id: string; name: string; driver: string };
  capabilities?: EntryCapabilities | null;
  updatedAt?: Date | string;
};

export type FileProp = {
  id: string;
  name: string;
  entryType: string;
  mimeType?: string | null;
  relativePath: string;
  sizeBytes?: number | null;
  sizeLabel: string;
  previewable: boolean;
  localEditable?: boolean;
  directAccessMode: string;
  directAccessHref?: string | null;
  directAccessDescription: string;
  storageNodeId: string;
  storageNodeName: string;
  storageNodeDriver: string;
  capabilities?: EntryCapabilities | null;
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
  const params = new URLSearchParams({
    path: entry.relativePath,
    ...(entry.storageNode.id ? { nodeId: entry.storageNode.id } : {}),
  });
  return `/api/storage/local?${params.toString()}`;
}

export function buildArchiveDownloadHref(input: {
  storageNodeId?: string | null;
  relativePath?: string | null;
}) {
  if (!input.storageNodeId || !input.relativePath) return null;
  const params = new URLSearchParams({
    nodeId: input.storageNodeId,
    path: input.relativePath,
  });
  return `/api/storage/archive-download?${params.toString()}`;
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

export function buildForcedDownloadHref(entry: StorageEntry) {
  return appendDownloadFlag(buildProxyDownloadHref(entry));
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
    const previewHref = buildProxyDownloadHref(entry);
    const params = new URLSearchParams({
      href: previewHref,
      name: entry.name,
      type: mime,
      driver: entry.storageNode.driver,
      ...(entry.storageNode.id ? { nodeId: entry.storageNode.id } : {}),
      ...(entry.relativePath ? { relativePath: entry.relativePath } : {}),
      ...(entry.localEditable ? { fileEntryId: entry.id, editable: "1" } : {}),
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
  return buildProxyDownloadHref(entry);
}

export function toStorageEntry(file: FileProp): StorageEntry {
  return {
    id: file.id,
    name: file.name,
    entryType: file.entryType,
    mimeType: file.mimeType,
    relativePath: file.relativePath,
    size: file.sizeBytes == null ? null : BigInt(file.sizeBytes),
    sizeLabel: file.sizeLabel,
    previewable: file.previewable,
    localEditable: file.localEditable ?? false,
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
    capabilities: file.capabilities,
    updatedAt: file.updatedAt ?? undefined,
  };
}
