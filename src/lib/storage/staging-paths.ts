/** Basename patterns used by storage writers for in-progress bytes and rollback copies. */
export const WEBDAV_STAGE_PREFIX = ".vcontrolhub-webdav-";
const uploadHex = "[0-9a-f]";
const uploadUuid = [8, 4, 4, 4, 12].map(length => uploadHex.repeat(length)).join("-");
export const storageStagingPatterns = [
  `${WEBDAV_STAGE_PREFIX}*.staged`, ".vch-upload-*.tmp",
  ".vch-upload-" + uploadUuid, ".vch-upload-" + "[a-z0-9_]".repeat(8), ".vch-edit-*.tmp", ".vch-write-*.tmp",
  ".vch-copy-*", ".vch-backup-*", ".vch-extract-*.tmp", ".vch-compress-*",
  ".vch-transfers-*", ".vch-publish-*",
];

// Keep bracket classes intact when making bsdtar's case-sensitive patterns match Windows names.
const globTokens = /\[[^\]]+\]|\*|./g;
export const localStorageStagingPatterns = process.platform === "win32"
  ? storageStagingPatterns.map(pattern => pattern.replace(globTokens, token => {
      if (token.startsWith("[")) return token.replace(/([a-z]-[a-z])/g, range => range + range.toUpperCase());
      return /^[a-z]$/.test(token) ? `[${token}${token.toUpperCase()}]` : token;
    }))
  : storageStagingPatterns;

const basenamePatterns = storageStagingPatterns.map(pattern => pattern.replace(globTokens, token => {
  if (token === "*") return "[^/]*";
  if (token === ".") return "\\.";
  return token;
}));
export const storageStagingPathRegex = `(^|/)(${basenamePatterns.join("|")})(/|$)`;
const stagingPath = new RegExp(storageStagingPathRegex);

export function isStorageStagingPath(relativePath: string) {
  return stagingPath.test(relativePath);
}
