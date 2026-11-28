/**
 * Shared sensitive remote-path matcher used by both AI read tools and the
 * command risk classifier (POSIX + Windows paths).
 *
 * Pure, dependency-free so client previews and server services can share it.
 */

/** Pseudo-filesystems: `/proc/<pid>/root/...` exposes arbitrary host files, `/dev` and `/sys` are not files to read. */
export const PSEUDO_FILESYSTEM_ROOTS = /^\/(?:proc\/(?:\d+|self|thread-self)(?:\/|$)|sys(?:\/|$)|dev(?:\/|$))/;

/** Directories whose contents are credentials, wherever they sit. */
export const SENSITIVE_PATH_SEGMENTS = new Set([
  ".ssh",
  ".gnupg",
  ".aws",
  ".kube",
  ".docker",
  ".config/gcloud",
  ".azure",
  "run/secrets",
]);

/** Files that hold secrets or shell history. */
export const SENSITIVE_FILE_GLOBS = [
  ".netrc",
  ".pgpass",
  ".my.cnf",
  ".git-credentials",
  ".npmrc",
  ".pypirc",
  ".env",
  ".env.*",
  "*.env",
  ".htpasswd",
  ".vault-token",
  "*.tfstate",
  "*.tfstate.*",
  "*.tfvars",
  ".bash_history",
  ".zsh_history",
  ".mysql_history",
  ".psql_history",
  ".python_history",
  ...["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"].flatMap((name) => [name, `${name}.*`]),
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "*.kdbx",
];

export const SENSITIVE_FILE_NAMES = new RegExp(
  `^(?:${SENSITIVE_FILE_GLOBS.map((glob) => glob.replaceAll(".", "\\.").replaceAll("*", ".*")).join("|")})$`,
  "i",
);

/** System files that hold password hashes or private keys, and device/process nodes that are not files to read. */
export const SENSITIVE_SYSTEM_PATHS =
  /^\/(?:etc\/(?:shadow|gshadow|shadow-|gshadow-|sudoers(?:\.d(?:\/.*)?)?|ssh\/ssh_host_[^/]*_key|master\.passwd|kubernetes\/admin\.conf|rancher\/k3s\/k3s\.yaml|wireguard\/[^/]+\.conf)|var\/lib\/docker\/containers\/[^/]+\/config\.v2\.json|run\/secrets(?:\/.*)?|dev(?:\/.*)?|proc\/(?:kcore|\d+\/(?:mem|environ|maps)))$/;

/** Windows system/credential paths. */
const WINDOWS_SENSITIVE_PATHS =
  /^[a-z]:\\(?:windows\\system32\\config\\(?:sam|security|system)|windows\\ntds(?:\\|$)|programdata\\ssh\\ssh_host_[^\\]*_key|users\\[^\\]+\\(?:\.ssh|\.aws|\.kube|\.azure|\.docker|appdata\\(?:roaming|local)\\(?:microsoft\\credentials|microsoft\\protect|gcloud)))/i;

/**
 * Returns true if the given POSIX or Windows remote path points to a sensitive
 * credential store, password hash, private key, or pseudo-filesystem.
 */
export function isSensitiveRemotePath(rawPath: string): boolean {
  const trimmed = rawPath.trim();
  if (!trimmed) return false;

  // Windows-style paths (drive letter or backslashes)
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.includes("\\")) {
    const winNormalized = trimmed.replace(/\//g, "\\").replace(/\\+/g, "\\");
    if (WINDOWS_SENSITIVE_PATHS.test(winNormalized)) return true;
    const winSegments = winNormalized.split("\\").filter((s) => s && s !== ".");
    const lowerSegments = winSegments.map((s) => s.toLowerCase());
    if (lowerSegments.some((segment) => SENSITIVE_PATH_SEGMENTS.has(segment))) return true;
    const winName = winSegments.at(-1) ?? "";
    return SENSITIVE_FILE_NAMES.test(winName);
  }

  const normalized = `/${trimmed.split("/").filter((segment) => segment !== "" && segment !== ".").join("/")}`;
  if (PSEUDO_FILESYSTEM_ROOTS.test(normalized)) return true;
  if (SENSITIVE_SYSTEM_PATHS.test(normalized)) return true;
  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.some(
      (segment, index) =>
        SENSITIVE_PATH_SEGMENTS.has(segment) ||
        SENSITIVE_PATH_SEGMENTS.has(`${segment}/${segments[index + 1] ?? ""}`),
    )
  ) {
    return true;
  }
  const name = segments.at(-1) ?? "";
  return SENSITIVE_FILE_NAMES.test(name);
}

/**
 * Scan arbitrary shell command text for embedded references to sensitive paths.
 */
export function commandMentionsSensitivePath(command: string): boolean {
  // Extract candidate path-like tokens (POSIX absolute, home-relative, Windows paths, or credential filenames)
  const tokens = command.match(/(?:[a-zA-Z]:[\\/][^\s'"`;&|<>]+|~\/[^\s'"`;&|<>]+|\/[^\s'"`;&|<>]+|\.[a-zA-Z0-9._-]+\/[^\s'"`;&|<>]+|[^\s'"`;&|<>]+\.(?:pem|key|p12|pfx|jks|keystore|kdbx|tfstate|tfvars|env)|\.env(?:\.[A-Za-z0-9._-]+)?)/gi);
  if (!tokens) return false;
  for (const token of tokens) {
    const cleaned = token.replace(/^~/, "/root").replace(/[),;:'"`]+$/, "");
    if (isSensitiveRemotePath(cleaned)) return true;
  }
  return false;
}
