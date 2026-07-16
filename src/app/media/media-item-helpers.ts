"use client";

import {
  appendDownloadFlag,
  buildProxyDownloadHref,
  buildSearchHref,
  toStorageEntry,
  type FileProp,
} from "@/app/files/file-entry-utils";

export interface MediaItem {
  id: string;
  name: string;
  relativePath: string;
  mediaType: string;
  size: bigint | number | null;
  favorite: boolean;
  tags: string[];
  mimeType: string;
  storageNode?: {
    id: string;
    name: string;
    basePath: string;
    driver: string;
    directAccessMode?: string | null;
    publicBaseUrl?: string | null;
    server?: { name: string } | null;
  } | null;
}

export type MediaTFn = (key: string) => string;

export function formatSize(bytes: bigint | number | null, t: MediaTFn) {
  if (!bytes) return t("mediaItemCard.unknown");
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function storageLabel(m: MediaItem, t: MediaTFn) {
  const node = m.storageNode;
  if (!node) return t("mediaItemCard.unknownStorage");
  const serverName = node.server?.name ?? t("mediaItemCard.localServer");
  return `${serverName} · ${node.basePath}`;
}

export function createStorageEntry(item: MediaItem, t: MediaTFn) {
  const node = item.storageNode;
  if (!node) return null;
  const rawMode = String(node.directAccessMode ?? "PROXY");
  const isDirectAccess = rawMode === "DIRECT" || rawMode === "direct-url";
  const file: FileProp = {
    id: item.id,
    name: item.name,
    entryType: "FILE",
    mimeType: item.mimeType,
    relativePath: item.relativePath,
    sizeBytes: item.size == null ? null : Number(item.size),
    sizeLabel: formatSize(item.size, t),
    previewable: true,
    directAccessMode: isDirectAccess ? "direct-url" : "managed-download",
    directAccessHref:
      isDirectAccess && node.publicBaseUrl
        ? `${node.publicBaseUrl.replace(/\/$/, "")}/${item.relativePath
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`
        : null,
    directAccessDescription: isDirectAccess
      ? t("mediaItemCard.directAccess")
      : t("mediaItemCard.managedDownload"),
    storageNodeId: node.id,
    storageNodeName: node.name,
    storageNodeDriver: node.driver,
    updatedAt: null,
  };
  return toStorageEntry(file);
}

export function containingFolderPath(relativePath: string) {
  const segments = relativePath.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function mediaTypeLabel(mediaType: string, t: MediaTFn) {
  if (mediaType === "image") return t("mediaItemCard.type.image");
  if (mediaType === "video") return t("mediaItemCard.type.video");
  if (mediaType === "audio") return t("mediaItemCard.type.audio");
  return t("mediaItemCard.type.other");
}

export function buildMediaLinks(item: MediaItem, t: MediaTFn) {
  const storageEntry = createStorageEntry(item, t);
  const previewHref = storageEntry
    ? `/media/${encodeURIComponent(item.id)}?from=${encodeURIComponent("/media")}`
    : null;
  const downloadHref = storageEntry
    ? appendDownloadFlag(buildProxyDownloadHref(storageEntry))
    : null;
  const sourceHref = item.storageNode
    ? buildSearchHref(containingFolderPath(item.relativePath), {
        nodeId: item.storageNode.id,
        q: item.name,
      })
    : null;
  return { storageEntry, previewHref, downloadHref, sourceHref };
}
