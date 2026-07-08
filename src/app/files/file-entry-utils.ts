import {
  ARCHIVE_MIME_SET,
  CSV_MIME_SET,
  EXTENDED_TEXT_MIME_SET,
  MARKDOWN_MIME_SET,
  OFFICE_MIME_SET,
} from "@/lib/storage/mime-constants";
import { toDateLocale } from "@/lib/i18n/locale-format";
import type { Locale } from "@/lib/i18n/translations";

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
  storageNode: { id: string; name: string; driver: string; serverId?: string | null };
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
  storageNodeServerId?: string | null;
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

/**
 * Well-known config file → systemd unit mapping. When the user opens a
 * config file on a SFTP-backed server, we surface a "保存并重载" button
 * for these matches so the change can take effect without an SSH session.
 *
 * Add to this map carefully — false positives lead to silent reload attempts
 * against a service that isn't installed on the target host (exit=1 noise).
 */
const RELOADABLE_CONFIG_MAP: Record<string, { kind: "systemd"; unit: string } | { kind: "compose" }> = {
  "nginx.conf": { kind: "systemd", unit: "nginx" },
  "redis.conf": { kind: "systemd", unit: "redis-server" },
  "sshd_config": { kind: "systemd", unit: "sshd" },
  "httpd.conf": { kind: "systemd", unit: "httpd" },
  "my.cnf": { kind: "systemd", unit: "mysql" },
  "docker-compose.yml": { kind: "compose" },
  "docker-compose.yaml": { kind: "compose" },
  "compose.yaml": { kind: "compose" },
  "compose.yml": { kind: "compose" },
};

export function deriveReloadTarget(entry: StorageEntry): {
  kind: "systemd" | "compose";
  unit?: string;
} | null {
  if (entry.storageNode.driver !== "SFTP") return null;
  if (!entry.storageNode.serverId) return null;
  const basename = entry.name.toLowerCase();
  const target = RELOADABLE_CONFIG_MAP[basename];
  if (!target) return null;
  if (target.kind === "systemd") return { kind: "systemd", unit: target.unit };
  return { kind: "compose" };
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
      ...(entry.storageNode.serverId
        ? { serverId: entry.storageNode.serverId }
        : {}),
    });
    const reloadTarget = entry.localEditable ? deriveReloadTarget(entry) : null;
    if (reloadTarget) {
      params.set("reloadKind", reloadTarget.kind);
      if (reloadTarget.unit) params.set("reloadUnit", reloadTarget.unit);
    }
    return `/files/preview?${params.toString()}`;
  }
  return entry.directAccess.mode === "managed-download" &&
    entry.directAccess.href
    ? entry.directAccess.href
    : buildDownloadHref(entry);
}

export function getPreviewActionCopy(entry: StorageEntry, t: (key: string) => string) {
  const mime = entry.mimeType ?? "";
  if (OFFICE_MIME_SET.has(mime)) {
    return {
      label: t("filesPage.preview.officeAria").replace("{name}", entry.name),
      title: t("filesPage.preview.officeTitle"),
    };
  }
  if (ARCHIVE_MIME_SET.has(mime)) {
    return {
      label: t("filesPage.preview.archiveAria").replace("{name}", entry.name),
      title: entry.storageNode.driver === "LOCAL"
        ? t("filesPage.preview.archiveLocalTitle")
        : t("filesPage.preview.archiveRemoteTitle"),
    };
  }
  return {
    label: t("filesPage.preview.defaultAria").replace("{name}", entry.name),
    title: t("filesPage.preview.defaultTitle"),
  };
}

export function formatDate(date: Date | string, locale?: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(toDateLocale(locale ?? "zh"), {
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

/**
 * Build a `/media?...` link that pre-fills the media library search
 * with this entry's name and (when the mime type maps to a known
 * media kind) a `type` filter. The media library page already wires
 * `q` and `type` query params into its search form, so this is just
 * a thin URL builder that lives next to the other `build*` helpers
 * to keep the detail panel chunk free of inline URLSearchParams
 * plumbing.
 */
export function getMediaTypeFromMime(mime: string | null | undefined): "image" | "video" | "audio" | null {
  const value = mime ?? "";
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value.startsWith("audio/")) return "audio";
  return null;
}

export function buildMediaLibraryHref(entry: StorageEntry): string {
  const params = new URLSearchParams({ q: entry.name });
  const mediaType = getMediaTypeFromMime(entry.mimeType);
  if (mediaType) params.set("type", mediaType);
  return `/media?${params.toString()}`;
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
      ...(file.storageNodeServerId
        ? { serverId: file.storageNodeServerId }
        : {}),
    },
    capabilities: file.capabilities,
    updatedAt: file.updatedAt ?? undefined,
  };
}
