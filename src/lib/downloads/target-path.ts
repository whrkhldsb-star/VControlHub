import path from "node:path";

import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { shellQuote } from "@/lib/shell-quote";

function normalizeBasePath(basePath: string | null | undefined): string {
  const requested = (basePath ?? "").trim() || "/root/downloads";
  const withLeadingSlash = requested.startsWith("/") ? requested : `/${requested}`;
  const normalized = path.posix.normalize(withLeadingSlash).replace(/\/+$/, "");
  return normalized || "/";
}

function isPathWithinBase(candidate: string, basePath: string): boolean {
  // basePath "/" (whole-disk nodes) must contain every normalized absolute
  // path; the naive `${basePath}/` concat would produce "//" and match nothing.
  if (basePath === "/") return candidate.startsWith("/");
  return candidate === basePath || candidate.startsWith(`${basePath}/`);
}

export function getDownloadTargetRelativePath(
  basePath: string | null | undefined,
  resolvedTargetPath: string,
): string {
  const base = normalizeBasePath(basePath);
  const normalizedTarget = path.posix.normalize(resolvedTargetPath).replace(/\/+$/, "") || "/";

  if (!isPathWithinBase(normalizedTarget, base)) {
    throw new ValidationError(t("backend.downloads.downloadTargetPathExceedsStorageNodeRoot"));
  }

  if (normalizedTarget === base) {
    return "";
  }

  // Whole-disk base ("/") has no prefix to strip; every other base strips
  // `base + "/"` (safe: isPathWithinBase guarantees the separator).
  if (base === "/") {
    return normalizedTarget.slice(1);
  }

  return normalizedTarget.slice(base.length + 1);
}

/**
 * Resolve a download destination directory against a StorageNode basePath.
 *
 * Download UI historically submits absolute paths (usually the node basePath),
 * while API callers may submit relative paths. Absolute paths are accepted only
 * when they already live under the StorageNode basePath. Relative paths are
 * joined to the basePath. Parent traversal and absolute paths outside the base
 * are rejected so remote download commands cannot write elsewhere on the VPS.
 */
export function resolveDownloadTargetPath(
  basePath: string | null | undefined,
  requestedPath: string | null | undefined,
): string {
  const base = normalizeBasePath(basePath);
  const requested = (requestedPath ?? "").trim();

  if (!requested || requested === "/") {
    return base;
  }

  const normalized = path.posix.normalize(requested);
  const candidate = path.posix.isAbsolute(requested)
    ? normalized.replace(/\/+$/, "") || "/"
    : path.posix.normalize(path.posix.join(base, normalized));

  if (!isPathWithinBase(candidate, base)) {
    throw new ValidationError(t("backend.downloads.downloadTargetPathExceedsStorageNodeRoot"));
  }

  return candidate;
}

/** Enter each directory from its verified parent. Only the configured root may be a link. */
export function enterDownloadTargetDirectory(basePath: string, targetPath: string, physicalTargetDir: string): string {
  const root = normalizeBasePath(basePath);
  const relative = getDownloadTargetRelativePath(root, targetPath);
  const parts = relative.split("/").filter(Boolean);
  // The controller resolved the requested file through the storage connection.
  // Carry that same physical root into the shell, including when the root itself is a link.
  const physicalRoot = parts.reduce(parent => path.posix.dirname(parent), physicalTargetDir);
  const components = parts.map(shellQuote).join(" ");
  return [
    "CDPATH=",
    `base_dir=${shellQuote(root)}`,
    `physical_root=${shellQuote(physicalRoot)}`,
    '[ "$(realpath -m -- "$base_dir")" = "$physical_root" ] || exit 65',
    '[ -d "$base_dir" ] || mkdir -p -- "$base_dir" || exit 65',
    'cd -P -- "$base_dir" || exit 65',
    'expected_dir=$(pwd -P) || exit 65',
    '[ "$expected_dir" = "$physical_root" ] || exit 65',
    `for component in ${components}; do`,
    '  [ ! -L "./$component" ] || exit 65',
    '  [ -d "./$component" ] || mkdir -- "./$component" || [ -d "./$component" ] || exit 65',
    '  cd -P -- "./$component" || exit 65',
    '  expected_dir=${expected_dir%/}/$component',
    '  [ "$(pwd -P)" = "$expected_dir" ] || exit 65',
    'done',
    'export expected_dir',
  ].join("\n");
}
