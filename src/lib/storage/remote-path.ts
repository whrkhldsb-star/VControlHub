import path from "node:path";

import { ValidationError } from "@/lib/errors";

/**
 * Normalize a user-supplied remote path so it is always rooted under the
 * storage node base path. Absolute-looking input such as "/etc/passwd" is
 * treated as a path relative to basePath ("etc/passwd"), not as a filesystem
 * absolute path on the remote VPS.
 */
export function normalizeRemotePath(
  basePath: string,
  requestedPath?: string | null,
): string {
  const base = normalizeAbsoluteBasePath(basePath);
  const normalizedRelative = normalizeRemoteRelativePath(requestedPath);

  if (!normalizedRelative) {
    return base;
  }

  const absolutePath = path.posix.normalize(
    path.posix.join(base, normalizedRelative),
  );
  if (absolutePath !== base && !absolutePath.startsWith(`${base}/`)) {
    throw new ValidationError("请求路径超出存储节点根目录");
  }

  return absolutePath;
}

export function normalizeRemoteRelativePath(requestedPath?: string | null): string {
  const requested = (requestedPath ?? "").trim();

  if (!requested || requested === "/") {
    return "";
  }

  const relativeRequest = requested.replace(/^\/+/, "");
  const normalizedRelative = path.posix.normalize(relativeRequest);

  if (
    normalizedRelative === "." ||
    normalizedRelative === ".." ||
    normalizedRelative.startsWith("../") ||
    path.posix.isAbsolute(normalizedRelative)
  ) {
    throw new ValidationError("请求路径超出存储节点根目录");
  }

  return normalizedRelative;
}

export function normalizeRemoteTargetPath(
  basePath: string,
  requestedPath?: string | null,
): string {
  const normalized = normalizeRemotePath(basePath, requestedPath);
  if (normalized === normalizeAbsoluteBasePath(basePath)) {
    throw new ValidationError("目标路径不能是存储节点根目录");
  }
  return normalized;
}

export function toClientStorageError(message = "远端存储操作失败") {
  return { error: message };
}

function normalizeAbsoluteBasePath(basePath: string) {
  const trimmed = basePath.trim() || "/";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const normalized = path.posix.normalize(withLeadingSlash).replace(/\/+$/, "");
  return normalized === "" ? "/" : normalized;
}
