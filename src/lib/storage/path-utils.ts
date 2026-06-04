import path from "node:path";

function getAppSlugForPathExpansion() {
  return process.env.APP_SLUG?.trim() || "vcontrolhub";
}

/**
 * Expand the portable shell-style placeholders that deployment templates store in
 * default storage roots. systemd/dotenv do not expand `${APP_SLUG:-...}` inside
 * EnvironmentFile values before the app reads them, so runtime file operations
 * must normalize the persisted base path before resolving child paths.
 */
export function expandStorageBasePath(basePath: string) {
  const appSlug = getAppSlugForPathExpansion();
  return basePath
    .replace(/\$\{APP_SLUG:-([^}]+)\}/g, (_match, fallback: string) => appSlug || fallback)
    .replace(/\$\{APP_SLUG\}/g, appSlug)
    .replace(/\$APP_SLUG\b/g, appSlug);
}

export type StoragePathResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

const INVALID_SEGMENT_CHARS = /[\u0000-\u001f\u007f\\:*?"<>|]/;
const INVALID_ARCHIVE_ENTRY_CHARS = /[\u0000-\u001f\u007f]/;
const MAX_PATH_LENGTH = 4096;
const MAX_SEGMENT_LENGTH = 255;

function normalizePathInput(value: string | null | undefined) {
  return (value ?? "").replace(/\\/g, "/").trim();
}

function validateSegments(rawValue: string, options: { allowEmpty: boolean }): StoragePathResult {
  const normalizedInput = normalizePathInput(rawValue);

  if (!normalizedInput || normalizedInput === ".") {
    return options.allowEmpty
      ? { ok: true, path: "" }
      : { ok: false, reason: "路径不能为空" };
  }

  if (normalizedInput.startsWith("/")) {
    return { ok: false, reason: "路径必须是相对路径" };
  }

  if (normalizedInput.length > MAX_PATH_LENGTH) {
    return { ok: false, reason: "路径过长" };
  }

  const segments = normalizedInput
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return options.allowEmpty
      ? { ok: true, path: "" }
      : { ok: false, reason: "路径不能为空" };
  }

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return { ok: false, reason: "路径不能包含 . 或 .." };
    }
    if (segment.length > MAX_SEGMENT_LENGTH) {
      return { ok: false, reason: "路径片段过长" };
    }
    if (INVALID_SEGMENT_CHARS.test(segment)) {
      return { ok: false, reason: "路径包含非法字符" };
    }
  }

  const normalized = path.posix.normalize(segments.join("/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    return { ok: false, reason: "路径超出允许范围" };
  }

  return { ok: true, path: normalized };
}

export function normalizeStorageRelativePath(value: string | null | undefined): StoragePathResult {
  return validateSegments(value ?? "", { allowEmpty: false });
}

export function normalizeStorageTargetDirectory(value: string | null | undefined): StoragePathResult {
  return validateSegments(value ?? "", { allowEmpty: true });
}

export function normalizeStorageEntryName(value: string | null | undefined): StoragePathResult {
  const raw = (value ?? "").trim();
  if (!raw) return { ok: false, reason: "名称不能为空" };
  if (raw.includes("/") || raw.includes("\\")) {
    return { ok: false, reason: "名称不能包含路径分隔符" };
  }
  return validateSegments(raw, { allowEmpty: false });
}

export function joinStoragePath(directory: string | null | undefined, name: string | null | undefined): StoragePathResult {
  const dir = normalizeStorageTargetDirectory(directory);
  if (!dir.ok) return dir;
  const entryName = normalizeStorageEntryName(name);
  if (!entryName.ok) return entryName;
  return { ok: true, path: dir.path ? `${dir.path}/${entryName.path}` : entryName.path };
}

export function getPathName(relativePath: string): string {
  const normalized = normalizeStorageRelativePath(relativePath);
  if (!normalized.ok) return "";
  const parts = normalized.path.split("/");
  return parts[parts.length - 1] ?? "";
}

export function resolveStoragePathWithinBase(basePath: string, relativePath: string | null | undefined): StoragePathResult {
  const normalizedPath = normalizeStorageRelativePath(relativePath);
  if (!normalizedPath.ok) {
    return normalizedPath;
  }

  const allowedRoot = path.resolve(expandStorageBasePath(basePath));
  const absolutePath = path.resolve(allowedRoot, normalizedPath.path);
  const relativeToRoot = path.relative(allowedRoot, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return { ok: false, reason: "路径超出允许范围" };
  }

  return { ok: true, path: absolutePath };
}

export function isSafeArchiveEntryPath(value: string | null | undefined): boolean {
  const rawInput = (value ?? "").trim();
  if (rawInput.includes("\\") || rawInput.includes(":")) return false;
  const normalizedInput = normalizePathInput(rawInput);
  if (
    !normalizedInput ||
    normalizedInput.length > MAX_PATH_LENGTH ||
    normalizedInput.startsWith("/") ||
    path.win32.isAbsolute(normalizedInput)
  ) return false;

  const normalized = path.posix.normalize(normalizedInput);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return false;
  }

  const segments = normalized.split("/").filter(Boolean);
  return segments.every((segment) => (
    segment !== "." &&
    segment !== ".." &&
    segment.length <= MAX_SEGMENT_LENGTH &&
    !INVALID_ARCHIVE_ENTRY_CHARS.test(segment)
  ));
}

export function sanitizeArchiveEntries<T extends { name: string }>(entries: T[]): T[] {
  return entries.filter((entry) => isSafeArchiveEntryPath(entry.name));
}
