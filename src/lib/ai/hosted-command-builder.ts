import { serviceCommand, type OsDialect } from "@/lib/ssh/os-dialect";
import { shellQuote } from "@/lib/shell-quote";
import { isValidTcpPort } from "@/lib/runtime/listen-port";
import type { HostedActionType } from "./hosted-tools";

// ── 根据操作类型构建 shell 命令 ─────────────────────────────

function normalizeTail(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value ?? 50);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) return null;
  return parsed;
}

function normalizeLogPath(value: unknown): string | null {
  const path = typeof value === "string" && value.trim() ? value.trim() : "/var/log/syslog";
  if (!path.startsWith("/")) return null;
  if (path.includes("\0") || path.includes("\n") || path.includes("\r")) return null;
  if (path.split("/").some((segment) => segment === "..")) return null;
  if (!/^[/A-Za-z0-9._+@:-]+$/.test(path)) return null;
  return path;
}

function normalizeFilter(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const filter = value.trim();
  if (filter.length > 120 || filter.includes("\0") || filter.includes("\n") || filter.includes("\r")) return null;
  return filter;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const identifier = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,127}$/.test(identifier)) return null;
  return identifier;
}

/** Docker image refs may include registry/path and tags (e.g. ghcr.io/org/app:1.0). */
function normalizeDockerImage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const image = value.trim();
  if (!image || image.length > 256) return null;
  if (image.includes("\0") || image.includes("\n") || image.includes("\r") || image.includes(" ")) return null;
  // allow slash for namespaced paths; still ban shell metacharacters
  if (!/^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,255}$/.test(image)) return null;
  if (image.includes("..")) return null;
  return image;
}

function normalizeConfigPath(value: unknown): string | null {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path.startsWith("/")) return null;
  if (path.includes("\0") || path.includes("\n") || path.includes("\r")) return null;
  if (path.split("/").some((segment) => segment === "..")) return null;
  if (!/^[/A-Za-z0-9._+@:-]+$/.test(path)) return null;
  return path;
}

/**
 * Canonical absolute path (A7-01): `//etc/shadow`, `/./etc/shadow` and
 * `/etc//shadow` all become `/etc/shadow` so the sensitive-path rules below
 * see the same string the kernel resolves. `..` stays refused outright.
 */
function normalizeAbsolutePath(value: unknown): string | null {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path.startsWith("/") || /[\0\n\r]/.test(path)) return null;
  const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.some((segment) => segment === "..")) return null;
  if (!/^[/A-Za-z0-9._+@:\- ]+$/.test(path)) return null;
  return `/${segments.join("/")}`;
}

/** Pseudo-filesystems: `/proc/<pid>/root/…` is any path on the host, `/dev` and `/sys` are not files to read. */
const PSEUDO_FILESYSTEM_ROOTS = /^\/(?:proc\/(?:\d+|self|thread-self)(?:\/|$)|sys(?:\/|$)|dev(?:\/|$))/;

/** Directories whose contents are credentials, wherever they sit. */
const SENSITIVE_PATH_SEGMENTS = new Set([".ssh", ".gnupg", ".aws", ".kube", ".docker", ".config/gcloud", ".azure", "run/secrets"]);
/** Files that hold secrets or shell history. */
const SENSITIVE_FILE_GLOBS = [
  ".netrc", ".pgpass", ".my.cnf", ".git-credentials", ".npmrc", ".pypirc", ".env", ".env.*", "*.env",
  ".htpasswd", ".vault-token", "*.tfstate", "*.tfstate.*", "*.tfvars",
  ".bash_history", ".zsh_history", ".mysql_history", ".psql_history", ".python_history",
  ...["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"].flatMap((name) => [name, `${name}.*`]),
  "*.pem", "*.key", "*.p12", "*.pfx", "*.jks", "*.keystore", "*.kdbx",
];
const SENSITIVE_FILE_NAMES = new RegExp(
  `^(?:${SENSITIVE_FILE_GLOBS.map((glob) => glob.replaceAll(".", "\\.").replaceAll("*", ".*")).join("|")})$`, "i",
);
/** System files that hold password hashes or private keys, and device/process nodes that are not files to read. */
const SENSITIVE_SYSTEM_PATHS = /^\/(?:etc\/(?:shadow|gshadow|shadow-|gshadow-|sudoers(?:\.d(?:\/.*)?)?|ssh\/ssh_host_[^/]*_key|master\.passwd|kubernetes\/admin\.conf|rancher\/k3s\/k3s\.yaml|wireguard\/[^/]+\.conf)|var\/lib\/docker\/containers\/[^/]+\/config\.v2\.json|run\/secrets(?:\/.*)?|dev(?:\/.*)?|proc\/(?:kcore|\d+\/(?:mem|environ|maps)))$/;

/**
 * The read tools run without anyone approving them and their output goes to the AI provider and into the
 * conversation: password hashes, private keys and credential stores are not for them (the terminal is).
 */
export function isSensitiveRemotePath(path: string): boolean {
  const normalized = `/${path.split("/").filter((segment) => segment !== "" && segment !== ".").join("/")}`;
  if (PSEUDO_FILESYSTEM_ROOTS.test(normalized)) return true;
  if (SENSITIVE_SYSTEM_PATHS.test(normalized)) return true;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment, index) => SENSITIVE_PATH_SEGMENTS.has(segment) || SENSITIVE_PATH_SEGMENTS.has(`${segment}/${segments[index + 1] ?? ""}`))) return true;
  const name = segments.at(-1) ?? "";
  return SENSITIVE_FILE_NAMES.test(name);
}

function normalizeReadablePath(value: unknown): string | null {
  const path = normalizeAbsolutePath(value);
  return path && !isSensitiveRemotePath(path) ? path : null;
}

/**
 * Directory base names a recursive search never descends into (and never starts in). Besides the
 * per-user credential stores this covers the system secret stores behind SENSITIVE_SYSTEM_PATHS
 * (D6-01): `/run/secrets`, `/etc/wireguard`, `/etc/kubernetes`, `/etc/rancher/k3s`, kubelet/rancher state.
 */
const SEARCH_EXCLUDED_DIRS = [
  ".ssh", ".gnupg", ".aws", ".kube", ".docker", ".azure", "gcloud", "sudoers.d", "proc", "sys", "dev",
  "secrets", "wireguard", "kubernetes", "k3s", "rancher", "kubelet",
];
/** File names a recursive search skips because they hold cluster credentials or container env secrets. */
const SEARCH_EXCLUDED_FILES = ["admin.conf", "k3s.yaml", "config.v2.json", "kubeconfig", "*.kubeconfig"];
/**
 * Trees a recursive search may not start in at all (D6-01): runtime secret mounts, container
 * state (plaintext container env), and cluster/VPN configuration. Listing them stays allowed.
 */
const SEARCH_PROTECTED_ROOTS = /^\/(?:run|var\/run|var\/lib\/(?:docker|containerd|kubelet|rancher)|etc\/(?:kubernetes|rancher|wireguard))(?:\/|$)/;

// Use the same policy in the target's filesystem namespace. Check both the resolved path
// and the opened descriptor, then give that descriptor to tail or use it as grep's cwd.
// A renamed directory or replaced symlink cannot redirect a later open of the input path.
// Kinds: "file" (tail), "directory" (listing), "tree" (recursive search; also refuses protected roots).
const OPEN_READABLE_TARGET = `import os, re, stat, sys
def check(path):
    if (not path.startswith("/") or path.endswith(" (deleted)") or "\\n" in path or "\\r" in path or
        re.match(r"${PSEUDO_FILESYSTEM_ROOTS.source}", path) or
        re.match(r"${SENSITIVE_SYSTEM_PATHS.source}", path) or
        re.fullmatch(r"${SENSITIVE_FILE_NAMES.source}", os.path.basename(path), re.IGNORECASE) or
        (sys.argv[2] != "file" and any(part in ${JSON.stringify(SEARCH_EXCLUDED_DIRS)} for part in path.split("/"))) or
        (sys.argv[2] == "tree" and re.match(r"${SEARCH_PROTECTED_ROOTS.source}", path)) or
        any("/" + part + "/" in path + "/" for part in ${JSON.stringify([...SENSITIVE_PATH_SEGMENTS])})):
        sys.exit("Protected path")

path = os.path.realpath(sys.argv[1])
check(path)
fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOCTTY | os.O_NOFOLLOW)
check(os.readlink("/proc/self/fd/" + str(fd)))
mode = os.fstat(fd).st_mode
if sys.argv[2] in ("directory", "tree") and stat.S_ISDIR(mode):
    os.fchdir(fd)
elif sys.argv[2] == "file" and stat.S_ISREG(mode):
    os.dup2(fd, 0)
else:
    sys.exit("Unexpected file type")
os.execvp(sys.argv[3], sys.argv[3:])`;

function openReadableTarget(path: string, kind: "file" | "directory" | "tree") {
  return `python3 -I -c ${shellQuote(OPEN_READABLE_TARGET)} ${shellQuote(path)} ${kind}`;
}

/** Same refusal as the "tree" check above, applied before a command is built at all. */
function isProtectedSearchRoot(path: string): boolean {
  return SEARCH_PROTECTED_ROOTS.test(path) || path.split("/").some((segment) => SEARCH_EXCLUDED_DIRS.includes(segment));
}

/** grep flags that keep a recursive search out of credential files and directories. */
const SEARCH_EXCLUDE_FLAGS = [
  ...SEARCH_EXCLUDED_DIRS.map((dir) => `--exclude-dir=${shellQuote(dir)}`),
  ...["shadow", "gshadow", "shadow-", "gshadow-", "sudoers", "master.passwd", "ssh_host_*_key", "*_history", ...SEARCH_EXCLUDED_FILES, ...SENSITIVE_FILE_GLOBS].map(
    (name) => `--exclude=${shellQuote(name.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`))}`,
  ),
].join(" ");

function normalizeLiteralQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const query = value.trim();
  return !query || query.length > 200 || /[\0\n\r]/.test(query) ? null : query;
}

function normalizeFilePattern(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "*";
  if (typeof value !== "string") return null;
  const pattern = value.trim();
  return /^[A-Za-z0-9*?._-]{1,80}$/.test(pattern) ? pattern : null;
}

function normalizeShellLiteral(value: unknown, maxLength = 10_000): string | null {
  if (typeof value !== "string") return null;
  if (value.includes("\0") || value.length > maxLength) return null;
  return value;
}

function normalizeConfigContent(value: unknown): string | null {
  const content = normalizeShellLiteral(value);
  if (content === null) return null;
  if (content.split(/\r?\n/).some((line) => line.trim() === "AIEOF")) return null;
  return content;
}

function normalizePortMappings(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const mappings = value.trim().split(/\s+/).filter(Boolean);
  if (mappings.length > 20) return null;
  for (const mapping of mappings) {
    if (!/^\d{1,5}:\d{1,5}(?:\/[A-Za-z]+)?$/.test(mapping)) return null;
    const [host, containerWithProto] = mapping.split(":");
    const container = containerWithProto?.split("/")[0];
    const hostPort = Number(host);
    const containerPort = Number(container);
    if (!isValidTcpPort(hostPort) || !isValidTcpPort(containerPort)) return null;
  }
  return mappings.join(" ");
}

function normalizeEnvVars(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 5000) return null;
  try {
    const envObj = JSON.parse(value) as unknown;
    if (!envObj || typeof envObj !== "object" || Array.isArray(envObj)) return null;
    return Object.entries(envObj as Record<string, unknown>)
      .map(([key, rawValue]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)) throw new Error("invalid env key");
        if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") throw new Error("invalid env value");
        return `-e ${key}=${shellQuote(String(rawValue))}`;
      })
      .join(" ");
  } catch {
    return null;
  }
}

export function buildCommand(actionType: HostedActionType, params: Record<string, unknown>, dialect?: OsDialect, operatingSystem = "LINUX"): string | null {
  // Every command below runs in a POSIX shell. Windows Agent uses ComSpec.
  if (operatingSystem !== "LINUX") return null;
  const sm = dialect?.serviceManager ?? "systemd";
  const sudo = dialect?.sudoPattern ?? "sudo -n";
  switch (actionType) {
    case "get_status":
      return "echo '=== UPTIME ===' && uptime && echo '=== MEMORY ===' && free -h && echo '=== DISK ===' && df -h / && echo '=== CPU ===' && top -bn1 | head -5";

    case "read_logs": {
      // The same rules as the other read tools (A7-01): `tail /etc/shadow` used to pass as a "log".
      const logPath = normalizeReadablePath(normalizeLogPath(params.logPath));
      const tail = normalizeTail(params.tail);
      const filter = normalizeFilter(params.filter);
      if (!logPath || !tail || filter === null) return null;
      let cmd = `${openReadableTarget(logPath, "file")} tail -n ${tail}`;
      if (filter) cmd += ` | grep -F -i -- ${shellQuote(filter)}`;
      return cmd;
    }

    case "execute_command": {
      const command = normalizeShellLiteral(params.command);
      return command?.trim() ? command : null;
    }

    case "list_docker_containers":
      return "docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'";

    case "list_files": {
      const path = normalizeReadablePath(params.path);
      if (!path) return null;
      const list = `import itertools, os, stat
with os.scandir(".") as entries:
    for entry in itertools.islice(entries, 200):
        info = entry.stat(follow_symlinks=False)
        print(stat.filemode(info.st_mode)[0].replace("-", "f"), info.st_size, entry.name, sep="\\t")`;
      return `${openReadableTarget(path, "directory")} python3 -I -c ${shellQuote(list)}`;
    }

    case "search_files": {
      const path = normalizeReadablePath(params.path);
      const query = normalizeLiteralQuery(params.query);
      const pattern = normalizeFilePattern(params.filePattern);
      if (!path || !query || !pattern) return null;
      // Never start a recursive walk inside a secret store or container/cluster state tree (D6-01).
      if (isProtectedSearchRoot(path)) return null;
      // A recursive grep reads every file below the directory; the credential
      // files the read tools refuse by name are skipped here too (A7-01).
      // GNU grep uses the last matching include/exclude flag. Start in a checked
      // directory and use -r so links discovered during descent are skipped.
      // Preserve the caller's absolute paths in the search results. normalizeAbsolutePath
      // permits none of the sed replacement metacharacters (backslash, ampersand, delimiter).
      const displayPrefix = path === "/" ? "" : path;
      const search = `grep -rFInI "$@" . 2>/dev/null | head -200 | sed ${shellQuote(`s|^\\./|${displayPrefix}/|`)}`;
      return `${openReadableTarget(path, "tree")} sh -c ${shellQuote(search)} sh --include=${shellQuote(pattern)} ${SEARCH_EXCLUDE_FLAGS} -- ${shellQuote(query)}`;
    }

    case "read_file": {
      const filePath = normalizeReadablePath(params.filePath);
      const tail = normalizeTail(params.tail ?? 100);
      if (!filePath || !tail) return null;
      return `${openReadableTarget(filePath, "file")} tail -n ${tail}`;
    }

    case "get_docker_logs": {
      const containerId = normalizeIdentifier(params.containerId);
      const tail = normalizeTail(params.tail ?? 100);
      if (!containerId || !tail) return null;
      return `docker logs --tail ${tail} -- ${shellQuote(containerId)} 2>&1`;
    }

    case "check_service_status": {
      const svc = normalizeIdentifier(params.serviceName);
      if (!svc) return null;
      return serviceCommand(sm, "status", svc, sudo);
    }

    case "restart_service": {
      const svc = normalizeIdentifier(params.serviceName);
      if (!svc) return null;
      return `${serviceCommand(sm, "restart", svc, sudo)} && ${serviceCommand(sm, "status", svc, sudo)}`;
    }

    case "modify_config": {
      const path = normalizeConfigPath(params.configPath);
      const content = normalizeConfigContent(params.content);
      if (!path || content === null) return null;
      // The timestamp stays outside the quotes so the shell expands it; quoted,
      // every backup was written to one literal "…bak.$(date +%s)" file.
      return `cp -- ${shellQuote(path)} ${shellQuote(`${path}.bak.`)}$(date +%s) && cat > ${shellQuote(path)} << 'AIEOF'\n${content}\nAIEOF`;
    }

    case "deploy_docker": {
      const img = normalizeDockerImage(params.imageName);
      const name = normalizeIdentifier(params.containerName);
      const ports = normalizePortMappings(params.ports);
      const envFlag = normalizeEnvVars(params.envVars);
      if (!img || !name || ports === null || envFlag === null) return null;
      const portFlag = ports ? ports.split(" ").map((port) => `-p ${port}`).join(" ") : "";
      return ["docker run -d", `--name ${name}`, portFlag, envFlag, img].filter(Boolean).join(" ");
    }

    default:
      return null;
  }
}
