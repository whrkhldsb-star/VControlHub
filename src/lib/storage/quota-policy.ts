import { normalizeStorageTargetDirectory } from "./path-utils";

export function normalizeAccessPath(value: string | null | undefined) {
  const result = normalizeStorageTargetDirectory(value, false);
  return result.ok ? result.path : null;
}

export function pathMatchesGrant(targetPath: string, pathPrefix: string, caseInsensitive = false) {
  const path = normalizeAccessPath(targetPath), grant = normalizeAccessPath(pathPrefix);
  if (path === null || grant === null) return false;
  const target = caseInsensitive ? path.toLowerCase() : path;
  const prefix = caseInsensitive ? grant.toLowerCase() : grant;
  return !prefix || target === prefix || target.startsWith(prefix + "/");
}

/** Any enclosing writable grant authorizes a write; every enclosing limit constrains it. */
export function quotaGrantPolicy<T extends { pathPrefix: string; canWrite: boolean }>(grants: T[], target: string, insensitive: boolean) {
  const matching = grants.filter(g => pathMatchesGrant(target, g.pathPrefix, insensitive));
  return { matching, writable: matching.find(g => g.canWrite) };
}
