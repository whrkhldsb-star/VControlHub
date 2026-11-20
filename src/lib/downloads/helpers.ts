/**
 * Downloads helpers — shared utilities for the downloads API route.
 * Extracted from route.ts for maintainability.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { type Aria2Status, formatBytes, formatSpeed, computeProgress } from "@/lib/aria2/service";
import { ValidationError } from "@/lib/errors";
import { resolveDownloadTargetPath } from "@/lib/downloads/target-path";
import { toRemoteChildPath } from "@/lib/downloads/remote-command";
import path from "path";
import { isPlainDownloadName } from "@/lib/downloads/file-name";
import { t } from "@/lib/i18n/service-translations";

/* File name sanitization */

export function normalizeDownloadFileName(fileName: string | null | undefined): string | null {
 const value = (fileName ?? "").trim();
 if (!value) return null;
 if (value.includes("\0") || value.includes("/") || value.includes("\\")) {
  throw new ValidationError(t("backend.downloads.downloadFilenameCannotContainPathSeparators"));
 }
 if (value === "." || value === "..") {
  throw new ValidationError(t("backend.downloads.downloadFilenameCannotContain"));
 }
 if (!isPlainDownloadName(value)) {
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
 if (!relative || (relative === ".." || relative.startsWith("../")) || path.posix.isAbsolute(relative)) {
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
 preserveRecycled?: boolean;
}, db?: Pick<Prisma.TransactionClient, "fileEntry">) {
 const safeFileName = normalizeDownloadFileName(input.fileName);
 if (!input.storageNode?.id || !safeFileName) return;

 const relativePath = relativePathFromDownloadTarget(input.storageNode.basePath, input.targetPath, safeFileName);
 if (!relativePath) return;

 const key = { storageNodeId: input.storageNode.id, relativePath };
 const data = { name: safeFileName, size: input.size == null ? null : BigInt(input.size), checksumSha256: null };
 const record = async (index: Pick<Prisma.TransactionClient, "fileEntry">) => {
  await index.fileEntry.createMany({ data: { ...key, ...data, entryType: "FILE" }, skipDuplicates: true });
  const updated = await index.fileEntry.updateMany({
   where: { ...key, entryType: "FILE", ...(input.preserveRecycled ? { isDeleted: false } : {}) },
   data: { ...data, isDeleted: false, deleteBatchId: null },
  });
  if (updated.count) return;
  if (input.preserveRecycled && await index.fileEntry.findFirst({ where: { ...key, entryType: "FILE", isDeleted: true }, select: { id: true } })) return;
  throw new ValidationError("Download destination is not a regular file");
 };
 if (db) await record(db);
 else await prisma.$transaction(record);
}

/* ── Aria2 status helpers ──────────────────────────────── */

/**
 * Relay downloads are not complete when aria2 finishes: the worker must still
 * transfer and index the artifact on the target VPS. Keep that intermediate
 * state RUNNING so list/refresh requests cannot terminate the workflow early.
 */
export function mapAria2RelayStatus(s: string): "RUNNING" | "FAILED" | "PENDING" {
 if (s === "error" || s === "removed") return "FAILED";
 if (s === "paused") return "PENDING";
 return "RUNNING";
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
  return `${t("backend.downloads.progress.completed")} · ${total}${name ? ` · ${name}` : ""}`;
 }
 if (st.status === "error") {
  return `${t("backend.downloads.progress.failed")} · ${completed}/${total}`;
 }
 if (st.status === "paused") {
  return `${t("backend.downloads.progress.paused")} · ${pct}% · ${completed}/${total}`;
 }
 return `${pct}% · ${completed}/${total}`;
}

/* ── Error message sanitization ────────────────────────── */

export function getPublicDownloadError(error: unknown): string {
 if (error instanceof Error && error.message.includes("No SSH key or password")) {
  return t("backend.downloads.error.noCredentials");
 }
 return t("backend.downloads.error.executionFailed");
}

/* ── Misc helpers ──────────────────────────────────────── */

export function isMagnetLink(url: string): boolean {
 return url.startsWith("magnet:?");
}
