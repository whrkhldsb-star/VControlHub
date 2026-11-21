/** Basename patterns used by storage writers for in-progress bytes and rollback copies. */
export const WEBDAV_STAGE_PREFIX = ".vcontrolhub-webdav-";
export const storageStagingPatterns = [
  `${WEBDAV_STAGE_PREFIX}*.staged`, ".vch-upload-*.tmp", ".vch-edit-*.tmp", ".vch-write-*.tmp",
  ".vch-copy-*", ".vch-backup-*", ".vch-extract-*.tmp", ".vch-compress-*",
  ".vch-transfers-*", ".vch-publish-*",
];

// bsdtar matches archive member names case-sensitively even on a Windows volume.
export const localStorageStagingPatterns = process.platform === "win32"
  ? storageStagingPatterns.map(pattern => pattern.replace(/[a-z]/g, letter => `[${letter}${letter.toUpperCase()}]`))
  : storageStagingPatterns;

const stagingNames = storageStagingPatterns.map(pattern => pattern.split("*"));
// A bound PostgreSQL regex matches one whole segment. A glob's wildcard cannot consume a slash.
const escapeRegex = (literal: string) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const storageStagingPathRegex = `(^|/)(${stagingNames.map(parts => parts.map(escapeRegex).join("[^/]*")).join("|")})(/|$)`;

export function isStorageStagingPath(relativePath: string) {
  return relativePath.split("/").some(part => stagingNames.some(([prefix, suffix]) =>
    part.startsWith(prefix!) && part.endsWith(suffix!)));
}
