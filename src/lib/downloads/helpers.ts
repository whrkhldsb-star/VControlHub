/**
 * Downloads helpers — shared utilities for the downloads API route.
 * Extracted from route.ts for maintainability.
 */

import { prisma } from "@/lib/db";
import { type Aria2Status, formatBytes, formatSpeed, computeProgress } from "@/lib/aria2/service";
import { ValidationError } from "@/lib/errors";
import { resolveDownloadTargetPath } from "@/lib/downloads/target-path";
import { toRemoteChildPath } from "@/lib/downloads/remote-command";
import path from "path";
import { t } from "@/lib/i18n/translations";

/* ── File name sanitization ────────────────────────────── */

export function normalizeDownloadFileName(fileName: string | null | undefined): string | null {
 const value = (fileName ?? "").trim();
 if (!value) return null;
 if (value.includes("\0") || value.includes("/") || value.includes("\\")) {
  throw new ValidationError(t("backend.downloads.downloadFilenameCannotContainPathSeparators"));
 }
 if (value === "." || value === ".." || value.includes("..")) {
  throw new ValidationError(t("backend.downloads.downloadFilenameCannotContain"));
 }
 if (/^[A-Za-z]:/.test(value) || /[\r\n]/.test(value)) {
  throw new ValidationError(t("backend.downloads.downloadFilenameInvalid"));
 }
 return value;
}

export function deriveDownloadFileNameFromUrl(url: string | null | undefined): string | null {
 try {
  const parsed = new URL(url ?? "");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const lastSegment = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "");
  return normalizeDownloadFileName(lastSegment) || null;
 } catch {
  return null;
 }
}

/* ── Path helpers ──────────────────────────────────────── */

export function relativePathFromDownloadTarget(
 basePath: string | null | undefined,
 targetPath: string,
 fileName: string,
): string | null {
 const base = resolveDownloadTargetPath(basePath, "");
 const fullPath = toRemoteChildPath(targetPath, fileName);
 const relative = path.posix.relative(base, fullPath);
 if (!relative || relative.startsWith("..") || path.posix.isAbsolute(relative)) {
  return null;
 }
 return relative;
}

/* ── File entry indexing ───────────────────────────────── */

export async function indexDownloadedFileEntry(input: {
 storageNode: { id: string; basePath: string | null } | null | undefined;
 targetPath: string;
 fileName: string | null | undefined;
 size: number | bigint | null | undefined;
}) {
 const safeFileName = normalizeDownloadFileName(input.fileName);
 if (!input.storageNode?.id || !safeFileName) return;

 const relativePath = relativePathFromDownloadTarget(input.storageNode.basePath, input.targetPath, safeFileName);
 if (!relativePath) return;

 const existingEntry = await prisma.fileEntry.findFirst({
  where: { storageNodeId: input.storageNode.id, relativePath },
  select: { id: true },
 });
 const data = {
  storageNodeId: input.storageNode.id,
  name: safeFileName,
  entryType: "FILE" as const,
  relativePath,
  size: input.size == null ? null : BigInt(input.size),
  isDeleted: false,
 };

 if (existingEntry) {
  await prisma.fileEntry.update({
   where: { id: existingEntry.id },
   data: { name: data.name, entryType: data.entryType, size: data.size, isDeleted: false },
  });
 } else {
  await prisma.fileEntry.create({ data });
 }
}

/* ── Aria2 status helpers ──────────────────────────────── */

/** Map aria2 status to our DownloadTaskStatus */
export function mapAria2Status(s: string): string {
 switch (s) {
  case "active": return "RUNNING";
  case "waiting": return "PENDING";
  case "paused": return "PENDING";
  case "error": return "FAILED";
  case "complete": return "COMPLETED";
  case "removed": return "CANCELLED";
  default: return "PENDING";
 }
}

/** Build a progress string from aria2 status */
export function buildProgressText(st: Aria2Status): string {
 const pct = computeProgress(st.completedLength, st.totalLength);
 const speed = formatSpeed(st.downloadSpeed);
 const completed = formatBytes(st.completedLength);
 const total = formatBytes(st.totalLength);
 const name =
  st.bittorrent?.info?.name ||
  (st.files?.[0]?.path ? path.basename(st.files[0].path) : "");
 if (st.status === "active") {
  return `${pct}% · ${speed} · ${completed}/${total}${name ? ` · ${name}` : ""}`;
 }
 if (st.status === "complete") {
  return `Completed · ${total}${name ? ` · ${name}` : ""}`;
 }
 if (st.status === "error") {
  return `Failed · ${completed}/${total}`;
 }
 return `${pct}% · ${completed}/${total}`;
}

/* ── Error message sanitization ────────────────────────── */

export function getPublicDownloadError(error: unknown): string {
 if (error instanceof Error && error.message.includes("No SSH key or password")) {
  return "Target VPS has no valid SSH credentials configured";
 }
 return "Download task execution failed, please check server logs";
}

/* ── Misc helpers ──────────────────────────────────────── */

export function isMagnetLink(url: string): boolean {
 return url.startsWith("magnet:?");
}
