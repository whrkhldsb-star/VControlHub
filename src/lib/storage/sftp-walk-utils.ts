/**
 * Shared SFTP directory-walk helpers used by sync and stale-inventory scanners.
 * Keep path semantics identical so prune/sync cannot drift.
 */

/** Race a directory list/scan against a timeout; clears the timer on settle. */
export async function withDirectoryTimeout<T>(
  operation: Promise<T>,
  dirPath: string,
  timeoutMs: number,
  options?: { stoppedVerb?: string },
): Promise<T> {
  const stoppedVerb = options?.stoppedVerb ?? "scanning";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Scanning ${dirPath} exceeded ${Math.ceil(timeoutMs / 1000)} seconds; stopped ${stoppedVerb} this directory`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Relative path for a directory entry under basePath, or null if outside the tree. */
export function computeRelativePath(
  basePath: string,
  remotePath: string,
  entryName: string,
): string | null {
  const normalizedBase = basePath.replace(/\/+$/, "") || "/";
  const normalizedRemote = remotePath.replace(/\/+$/, "") || "/";

  let relative: string;
  if (normalizedRemote === normalizedBase) {
    relative = entryName;
  } else if (normalizedBase === "/" && normalizedRemote.startsWith("/")) {
    relative = `${normalizedRemote.slice(1)}/${entryName}`;
  } else if (normalizedRemote.startsWith(`${normalizedBase}/`)) {
    relative = `${normalizedRemote.slice(normalizedBase.length + 1)}/${entryName}`;
  } else {
    return null;
  }

  return relative.replace(/^\/+/, "");
}

/**
 * Relative path of a directory itself under basePath.
 * Returns "" for the base, or null when remotePath is outside the tree
 * (callers that want a soft empty can coalesce).
 */
export function computeDirectoryRelativePath(
  basePath: string,
  remotePath: string,
): string | null {
  const normalizedBase = basePath.replace(/\/+$/, "") || "/";
  const normalizedRemote = remotePath.replace(/\/+$/, "") || "/";

  if (normalizedRemote === normalizedBase) return "";
  if (normalizedBase === "/" && normalizedRemote.startsWith("/")) {
    return normalizedRemote.slice(1);
  }
  if (normalizedRemote.startsWith(`${normalizedBase}/`)) {
    return normalizedRemote.slice(normalizedBase.length + 1);
  }
  return null;
}
