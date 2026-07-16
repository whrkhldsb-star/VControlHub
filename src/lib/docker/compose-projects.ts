/**
 * Docker Compose project lifecycle (FEAT-P0-2 completion).
 *
 * Projects are discovered from container labels:
 *   com.docker.compose.project / com.docker.compose.service / ...
 *
 * Actions prefer the real Compose CLI (`docker compose -p <project> ...`)
 * on hub-host or remote VPS (SSH). If the CLI is missing or the project
 * directory is unavailable, fall back to Docker Engine bulk ops filtered by
 * the project label — still project-scoped, never whole-daemon.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { prisma } from "@/lib/db";
import { BusinessError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import {
  buildSshParamsFromServer,
  execRemoteCommand,
} from "@/lib/ssh/client";
import {
  dockerRequest,
  type DockerScope,
  hubHostDockerScope,
  remoteVpsDockerScope,
} from "@/lib/docker/engine-client";

const runFile = promisify(execFile);
const logger = createLogger("docker-compose-projects");

export const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
export const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";
export const COMPOSE_WORKING_DIR_LABEL = "com.docker.compose.project.working_dir";
export const COMPOSE_CONFIG_FILES_LABEL = "com.docker.compose.project.config_files";

export type ComposeProjectAction =
  | "ps"
  | "up"
  | "down"
  | "start"
  | "stop"
  | "restart";

export type ComposeContainerSummary = {
  id: string;
  name: string;
  state: string;
  status: string;
  image: string;
  service: string | null;
};

export type ComposeProjectSummary = {
  project: string;
  containerCount: number;
  runningCount: number;
  services: string[];
  workingDir: string | null;
  configFiles: string | null;
  containers: ComposeContainerSummary[];
};

export type ComposeActionResult = {
  project: string;
  action: ComposeProjectAction;
  mode: "compose-cli" | "engine-fallback";
  scope: DockerScope;
  stdout?: string;
  stderr?: string;
  containers?: ComposeContainerSummary[];
  message: string;
};

const PROJECT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export function assertValidComposeProjectName(project: string): string {
  const name = project.trim();
  if (!PROJECT_NAME_RE.test(name)) {
    throw new ValidationError(
      "Invalid compose project name (allowed: letters, digits, _ . - ; max 128)",
    );
  }
  return name;
}

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function containerName(raw: unknown): string {
  if (Array.isArray(raw) && typeof raw[0] === "string") {
    return String(raw[0]).replace(/^\//, "");
  }
  if (typeof raw === "string") return raw.replace(/^\//, "");
  return "";
}

type EngineContainer = {
  Id?: string;
  Names?: string[];
  State?: string;
  Status?: string;
  Image?: string;
  Labels?: Record<string, string>;
};

function summarizeContainers(list: EngineContainer[]): ComposeContainerSummary[] {
  return list.map((c) => ({
    id: c.Id ?? "",
    name: containerName(c.Names) || (c.Id ?? "").slice(0, 12),
    state: c.State ?? "unknown",
    status: c.Status ?? "",
    image: c.Image ?? "",
    service: c.Labels?.[COMPOSE_SERVICE_LABEL] ?? null,
  }));
}

export function groupComposeProjects(containers: EngineContainer[]): ComposeProjectSummary[] {
  const map = new Map<string, EngineContainer[]>();
  for (const c of containers) {
    const project = c.Labels?.[COMPOSE_PROJECT_LABEL]?.trim();
    if (!project) continue;
    const list = map.get(project) ?? [];
    list.push(c);
    map.set(project, list);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([project, list]) => {
      const services = Array.from(
        new Set(
          list
            .map((c) => c.Labels?.[COMPOSE_SERVICE_LABEL])
            .filter((s): s is string => Boolean(s && s.trim())),
        ),
      ).sort();
      const first = list[0];
      return {
        project,
        containerCount: list.length,
        runningCount: list.filter((c) => (c.State ?? "").toLowerCase() === "running").length,
        services,
        workingDir: first?.Labels?.[COMPOSE_WORKING_DIR_LABEL] ?? null,
        configFiles: first?.Labels?.[COMPOSE_CONFIG_FILES_LABEL] ?? null,
        containers: summarizeContainers(list),
      };
    });
}

async function listAllContainers(serverId?: string): Promise<{
  containers: EngineContainer[];
  scope: DockerScope;
  dockerAvailable: boolean;
  message?: string;
}> {
  const { result, scope } = await dockerRequest("/containers/json?all=true", {
    unavailableData: [],
    loggerScope: "docker:compose:list",
    serverId,
  });
  if (!result.ok && result.dockerAvailable === false) {
    return {
      containers: [],
      scope,
      dockerAvailable: false,
      message: result.message,
    };
  }
  if (!result.ok) {
    const msg =
      result.data && typeof result.data === "object" && "message" in result.data
        ? String((result.data as { message?: unknown }).message ?? "Docker list failed")
        : "Docker list failed";
    throw new BusinessError(msg);
  }
  const containers = Array.isArray(result.data) ? (result.data as EngineContainer[]) : [];
  return {
    containers,
    scope,
    dockerAvailable: result.dockerAvailable !== false,
    message: result.message,
  };
}

export async function listComposeProjects(serverId?: string): Promise<{
  projects: ComposeProjectSummary[];
  scope: DockerScope;
  dockerAvailable: boolean;
  message?: string;
}> {
  const listed = await listAllContainers(serverId);
  return {
    projects: groupComposeProjects(listed.containers),
    scope: listed.scope,
    dockerAvailable: listed.dockerAvailable,
    message: listed.message,
  };
}

async function resolveScope(serverId?: string): Promise<DockerScope> {
  if (!serverId) return hubHostDockerScope;
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { id: true, name: true, enabled: true },
  });
  if (!server) throw new ValidationError("Target VPS not found");
  if (!server.enabled) throw new ValidationError("Target VPS is disabled");
  return remoteVpsDockerScope(server.id, server.name);
}

async function runLocalCommand(
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await runFile(args[0]!, args.slice(1), {
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: String(stdout), stderr: String(stderr), exitCode: 0 };
  } catch (error) {
    const err = error as {
      code?: string | number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (err.code === "ENOENT") {
      throw Object.assign(new Error("docker CLI not found"), { code: "ENOENT" });
    }
    return {
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message ?? "command failed"),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

async function runRemoteDockerCommand(
  serverId: string,
  command: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: {
      sshKey: { select: { privateKey: true, passphrase: true } },
    },
  });
  if (!server) throw new ValidationError("Target VPS not found");
  if (!server.enabled) throw new ValidationError("Target VPS is disabled");
  const ssh = await buildSshParamsFromServer(
    {
      host: server.host,
      port: server.port,
      username: server.username,
      sshKeyId: server.sshKeyId,
      password: server.password,
      hostKeySha256: (server as { hostKeySha256?: string | null }).hostKeySha256 ?? null,
    },
    server.sshKey,
  );
  const result = await execRemoteCommand({
    ...ssh,
    command,
    timeout: timeoutMs,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 1,
  };
}

function buildComposeCliArgs(
  project: string,
  action: ComposeProjectAction,
  options: { removeVolumes?: boolean; workingDir?: string | null; configFiles?: string | null },
): { argv: string[]; remoteCommand: string; timeoutMs: number } {
  const timeoutMs =
    action === "up" || action === "down" ? 300_000 : action === "ps" ? 30_000 : 120_000;

  const base: string[] = ["docker", "compose", "-p", project];
  // Prefer original compose files/working dir when labels expose them.
  if (options.workingDir && options.workingDir.startsWith("/") && !options.workingDir.includes("..")) {
    base.push("--project-directory", options.workingDir);
  }
  if (options.configFiles) {
    for (const file of options.configFiles.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (file.startsWith("/") && !file.includes("..")) {
        base.push("-f", file);
      }
    }
  }

  switch (action) {
    case "ps":
      base.push("ps", "--format", "json");
      break;
    case "up":
      base.push("up", "-d", "--remove-orphans");
      break;
    case "down":
      base.push("down", "--remove-orphans");
      if (options.removeVolumes) base.push("-v");
      break;
    case "start":
      base.push("start");
      break;
    case "stop":
      base.push("stop");
      break;
    case "restart":
      base.push("restart");
      break;
    default:
      throw new ValidationError(`Unsupported compose action: ${action}`);
  }

  const remoteCommand = base.map(shellQuote).join(" ");
  return { argv: base, remoteCommand, timeoutMs };
}

async function tryComposeCli(
  project: string,
  action: ComposeProjectAction,
  serverId: string | undefined,
  options: { removeVolumes?: boolean; workingDir?: string | null; configFiles?: string | null },
): Promise<{ ok: boolean; stdout: string; stderr: string; mode: "compose-cli" }> {
  const { argv, remoteCommand, timeoutMs } = buildComposeCliArgs(project, action, options);
  const result = serverId
    ? await runRemoteDockerCommand(serverId, remoteCommand, timeoutMs)
    : await runLocalCommand(argv, timeoutMs);

  if (result.exitCode === 0) {
    return { ok: true, stdout: result.stdout, stderr: result.stderr, mode: "compose-cli" };
  }

  const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();
  // Missing compose plugin / no project config → caller may fall back.
  if (
    combined.includes("unknown command") ||
    combined.includes("is not a docker command") ||
    combined.includes("unknown shorthand flag") ||
    combined.includes("unknown flag") ||
    combined.includes("no configuration file") ||
    combined.includes("no such file") ||
    combined.includes("not found") ||
    combined.includes("compose file") ||
    combined.includes("couldn't find env file") ||
    combined.includes("docker compose") && combined.includes("plugin")
  ) {
    logger.info("compose CLI unavailable or project config missing; will fall back", {
      project,
      action,
      serverId: serverId ?? "hub-host",
      stderr: result.stderr.slice(0, 300),
    });
    return { ok: false, stdout: result.stdout, stderr: result.stderr, mode: "compose-cli" };
  }

  throw new BusinessError(
    (result.stderr || result.stdout || `compose ${action} failed`).slice(0, 800),
  );
}

async function engineActionOnProjectContainers(
  project: string,
  action: Exclude<ComposeProjectAction, "ps" | "up" | "down"> | "start" | "stop" | "restart" | "remove",
  serverId: string | undefined,
): Promise<ComposeContainerSummary[]> {
  const listed = await listAllContainers(serverId);
  const targets = listed.containers.filter(
    (c) => c.Labels?.[COMPOSE_PROJECT_LABEL] === project,
  );
  if (targets.length === 0) {
    throw new BusinessError(`No containers found for compose project "${project}"`);
  }

  for (const c of targets) {
    const id = c.Id;
    if (!id) continue;
    let path = "";
    if (action === "start") path = `/containers/${id}/start`;
    else if (action === "stop") path = `/containers/${id}/stop`;
    else if (action === "restart") path = `/containers/${id}/restart`;
    else if (action === "remove") path = `/containers/${id}?force=true`;
    else continue;

    const { result } = await dockerRequest(path, {
      method: "POST",
      unavailableData: {},
      loggerScope: "docker:compose:fallback",
      serverId,
    });
    // 304 = already started/stopped — treat as success
    if (!result.ok && result.status !== 304 && result.status !== 204) {
      const msg =
        result.data && typeof result.data === "object" && "message" in result.data
          ? String((result.data as { message?: unknown }).message ?? "container action failed")
          : `container ${action} failed (${result.status})`;
      throw new BusinessError(`${msg} [${id.slice(0, 12)}]`);
    }
  }

  const after = await listAllContainers(serverId);
  return summarizeContainers(
    after.containers.filter((c) => c.Labels?.[COMPOSE_PROJECT_LABEL] === project),
  );
}

export async function runComposeProjectAction(input: {
  project: string;
  action: ComposeProjectAction;
  serverId?: string;
  removeVolumes?: boolean;
}): Promise<ComposeActionResult> {
  const project = assertValidComposeProjectName(input.project);
  const action = input.action;
  const scope = await resolveScope(input.serverId);

  // Snapshot labels for working dir / compose files
  const listed = await listAllContainers(input.serverId);
  const projectContainers = listed.containers.filter(
    (c) => c.Labels?.[COMPOSE_PROJECT_LABEL] === project,
  );
  const first = projectContainers[0];
  const workingDir = first?.Labels?.[COMPOSE_WORKING_DIR_LABEL] ?? null;
  const configFiles = first?.Labels?.[COMPOSE_CONFIG_FILES_LABEL] ?? null;

  if (action === "ps") {
    // Prefer live compose ps; fall back to engine summary.
    const cli = await tryComposeCli(project, "ps", input.serverId, { workingDir, configFiles });
    if (cli.ok) {
      return {
        project,
        action,
        mode: "compose-cli",
        scope,
        stdout: cli.stdout,
        stderr: cli.stderr,
        containers: summarizeContainers(projectContainers),
        message: `Compose project "${project}" status loaded via docker compose`,
      };
    }
    return {
      project,
      action,
      mode: "engine-fallback",
      scope,
      containers: summarizeContainers(projectContainers),
      message: `Compose project "${project}" status loaded from container labels`,
    };
  }

  // For lifecycle mutations, try compose CLI first.
  const cli = await tryComposeCli(project, action, input.serverId, {
    removeVolumes: input.removeVolumes === true,
    workingDir,
    configFiles,
  });
  if (cli.ok) {
    const after = await listAllContainers(input.serverId);
    const containers = summarizeContainers(
      after.containers.filter((c) => c.Labels?.[COMPOSE_PROJECT_LABEL] === project),
    );
    return {
      project,
      action,
      mode: "compose-cli",
      scope,
      stdout: cli.stdout.slice(0, 4000),
      stderr: cli.stderr.slice(0, 2000),
      containers,
      message: `Compose project "${project}" ${action} completed via docker compose`,
    };
  }

  // Fallback mapping
  if (action === "up" || action === "start") {
    const containers = await engineActionOnProjectContainers(project, "start", input.serverId);
    return {
      project,
      action,
      mode: "engine-fallback",
      scope,
      containers,
      message: `Compose CLI unavailable; started ${containers.length} container(s) for project "${project}" via Engine API`,
    };
  }
  if (action === "stop") {
    const containers = await engineActionOnProjectContainers(project, "stop", input.serverId);
    return {
      project,
      action,
      mode: "engine-fallback",
      scope,
      containers,
      message: `Compose CLI unavailable; stopped ${containers.length} container(s) for project "${project}" via Engine API`,
    };
  }
  if (action === "restart") {
    const containers = await engineActionOnProjectContainers(project, "restart", input.serverId);
    return {
      project,
      action,
      mode: "engine-fallback",
      scope,
      containers,
      message: `Compose CLI unavailable; restarted ${containers.length} container(s) for project "${project}" via Engine API`,
    };
  }
  if (action === "down") {
    // stop then remove containers; never delete volumes unless explicitly requested (and only via CLI path).
    await engineActionOnProjectContainers(project, "stop", input.serverId);
    const containers = await engineActionOnProjectContainers(project, "remove", input.serverId);
    return {
      project,
      action,
      mode: "engine-fallback",
      scope,
      containers,
      message: `Compose CLI unavailable; removed ${containers.length || projectContainers.length} container(s) for project "${project}" via Engine API (volumes kept)`,
    };
  }

  throw new BusinessError(`Unsupported compose action: ${action}`);
}
