/**
 * The path of a descendant after its directory moved from `oldPrefix` to `newPrefix` (both with the trailing slash).
 * `String.replace(oldPrefix, newPrefix)` read `$$`, `$&`, `` $` `` and `$'` in the new name as replacement patterns
 * ("Cash$$" became "Cash$"), so the index pointed at paths that do not exist.
 */
export function rebaseDescendantPath(path: string, oldPrefix: string, newPrefix: string): string {
  return path.startsWith(oldPrefix) ? newPrefix + path.slice(oldPrefix.length) : path;
}
