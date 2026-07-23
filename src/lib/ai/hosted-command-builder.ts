import { serviceCommand, type OsDialect } from "@/lib/ssh/os-dialect";
import type { HostedActionType } from "./hosted-tools";

// ── 根据操作类型构建 shell 命令 ─────────────────────────────

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

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

function normalizeAbsolutePath(value: unknown): string | null {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path.startsWith("/") || /[\0\n\r]/.test(path)) return null;
  if (path.split("/").some((segment) => segment === "..")) return null;
  if (!/^[/A-Za-z0-9._+@:\- ]+$/.test(path)) return null;
  return path;
}

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
    if (!Number.isInteger(hostPort) || !Number.isInteger(containerPort) || hostPort < 1 || hostPort > 65535 || containerPort < 1 || containerPort > 65535) return null;
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

export function buildCommand(actionType: HostedActionType, params: Record<string, unknown>, dialect?: OsDialect): string | null {
  const sm = dialect?.serviceManager ?? "systemd";
  const sudo = dialect?.sudoPattern ?? "sudo -n";
  switch (actionType) {
    case "get_status":
      return "echo '=== UPTIME ===' && uptime && echo '=== MEMORY ===' && free -h && echo '=== DISK ===' && df -h / && echo '=== CPU ===' && top -bn1 | head -5";

    case "read_logs": {
      const logPath = normalizeLogPath(params.logPath);
      const tail = normalizeTail(params.tail);
      const filter = normalizeFilter(params.filter);
      if (!logPath || !tail || filter === null) return null;
      let cmd = `tail -n ${tail} -- ${shellQuote(logPath)}`;
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
      const path = normalizeAbsolutePath(params.path);
      if (!path) return null;
      return `find ${shellQuote(path)} -mindepth 1 -maxdepth 1 -printf '%y\t%s\t%f\n' 2>/dev/null | head -200`;
    }

    case "search_files": {
      const path = normalizeAbsolutePath(params.path);
      const query = normalizeLiteralQuery(params.query);
      const pattern = normalizeFilePattern(params.filePattern);
      if (!path || !query || !pattern) return null;
      return `grep -rFInI --include=${shellQuote(pattern)} -- ${shellQuote(query)} ${shellQuote(path)} 2>/dev/null | head -200`;
    }

    case "read_file": {
      const filePath = normalizeAbsolutePath(params.filePath);
      const tail = normalizeTail(params.tail ?? 100);
      if (!filePath || !tail) return null;
      return `tail -n ${tail} -- ${shellQuote(filePath)}`;
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
      return `cp -- ${shellQuote(path)} ${shellQuote(`${path}.bak.$(date +%s)`)} && cat > ${shellQuote(path)} << 'AIEOF'\n${content}\nAIEOF`;
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
