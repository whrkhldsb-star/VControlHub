import path from "node:path";

import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

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
