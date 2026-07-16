/**
 * Docker CLI adapter for Quick Services.
 *
 * Local (hub-host) keeps the historical sync helpers used by unit tests.
 * Remote VPS installs go through SSH (`execRemoteCommand`) via the async
 * target-aware helpers.
 */
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";

import { prisma } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import {
  buildSshParamsFromServer,
  execRemoteCommand,
} from "@/lib/ssh/client";

const runFile = promisify(execFile);
const logger = createLogger("quick-service-docker");

export const HUB_HOST_INSTANCE_KEY = "hub-host";

export type DockerTarget =
  | { kind: "local" }
  | { kind: "remote"; serverId: string };

export function instanceKeyForTarget(target: DockerTarget): string {
  return target.kind === "local" ? HUB_HOST_INSTANCE_KEY : target.serverId;
}

export function targetFromService(svc: {
  instanceKey?: string | null;
  serverId?: string | null;
}): DockerTarget {
  if (!svc.instanceKey || svc.instanceKey === HUB_HOST_INSTANCE_KEY) {
    return { kind: "local" };
  }
  return { kind: "remote", serverId: svc.serverId || svc.instanceKey };
}

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function buildDockerCommand(args: string[]): string {
  return ["docker", ...args.map(shellQuote)].join(" ");
}

async function loadRemoteSshParams(serverId: string) {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: {
      sshKey: {
        select: {
          privateKey: true,
          passphrase: true,
        },
      },
    },
  });
  if (!server) throw new BusinessError(`Target VPS not found: ${serverId}`);
  if (!server.enabled) throw new BusinessError(`Target VPS is disabled: ${server.name}`);
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
  return { server, ssh };
}

/** Local-only sync helper (historical API, used by unit tests). */
export function dockerExecSync(args: string[], timeout = 30_000): string {
  return execFileSync("docker", args, {
    timeout,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Target-aware docker exec (local sync path or remote SSH). */
export async function dockerExec(
  target: DockerTarget,
  args: string[],
  timeoutMs = 30_000,
): Promise<string> {
  if (target.kind === "local") {
    return dockerExecSync(args, timeoutMs);
  }
  const { server, ssh } = await loadRemoteSshParams(target.serverId);
  const command = buildDockerCommand(args);
  logger.debug("remote docker exec", {
    serverId: server.id,
    serverName: server.name,
    args: args.slice(0, 6),
  });
  const result = await execRemoteCommand({
    ...(ssh as object),
    command,
    timeout: timeoutMs,
  } as Parameters<typeof execRemoteCommand>[0]);
  if (result.exitCode !== 0 && result.exitCode !== null) {
    const msg = (result.stderr || result.stdout || `exit ${result.exitCode}`).trim();
    throw new Error(msg || `Remote docker failed on ${server.name}`);
  }
  return result.stdout;
}

export async function dockerRun(
  target: DockerTarget,
  args: string[],
  timeoutMs = 300_000,
): Promise<{ stdout: string; stderr: string }> {
  if (target.kind === "local") {
    const { stdout, stderr } = await runFile("docker", args, {
      timeout: timeoutMs,
      encoding: "utf8",
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  }
  const { server, ssh } = await loadRemoteSshParams(target.serverId);
  const result = await execRemoteCommand({
    ...(ssh as object),
    command: buildDockerCommand(args),
    timeout: timeoutMs,
  } as Parameters<typeof execRemoteCommand>[0]);
  if (result.exitCode !== 0 && result.exitCode !== null) {
    const msg = (result.stderr || result.stdout || `exit ${result.exitCode}`).trim();
    throw new Error(msg || `Remote docker run failed on ${server.name}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

export function dockerErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const maybe = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const stderr = typeof maybe.stderr === "string" ? maybe.stderr.trim() : "";
    const stdout = typeof maybe.stdout === "string" ? maybe.stdout.trim() : "";
    const message = typeof maybe.message === "string" ? maybe.message.trim() : "";
    return stderr || stdout || message || String(error);
  }
  return String(error);
}

/** Local sync health probe (historical API). */
export function getContainerHealth(containerName: string, timeoutMs = 10_000): string | null {
  try {
    const health = dockerExecSync(
      [
        "inspect",
        "--format={{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
        containerName,
      ],
      timeoutMs,
    ).trim();
    return health || null;
  } catch {
    return null;
  }
}

export async function getContainerHealthFor(
  target: DockerTarget,
  containerName: string,
  timeoutMs = 10_000,
): Promise<string | null> {
  try {
    const health = (
      await dockerExec(
        target,
        [
          "inspect",
          "--format={{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
          containerName,
        ],
        timeoutMs,
      )
    ).trim();
    return health || null;
  } catch {
    return null;
  }
}

/** Local sync log tail (historical API). */
export function getContainerLogTail(containerName: string, timeoutMs = 10_000): string | null {
  try {
    const logs = dockerExecSync(["logs", "--tail", "20", containerName], timeoutMs).trim();
    if (!logs) return null;
    return logs.slice(-2000);
  } catch {
    return null;
  }
}

export async function getContainerLogTailFor(
  target: DockerTarget,
  containerName: string,
  timeoutMs = 10_000,
): Promise<string | null> {
  try {
    const logs = (await dockerExec(target, ["logs", "--tail", "20", containerName], timeoutMs)).trim();
    if (!logs) return null;
    return logs.slice(-2000);
  } catch {
    return null;
  }
}

export type DockerEnvironmentStatus = {
  available: boolean;
  running: boolean;
  version: string | null;
  message: string | null;
  installHint: string | null;
  scope?: "hub-host" | "remote-vps";
  serverId?: string;
  serverName?: string;
};

/** Local sync status (historical API used by tests + local install preflight). */
export function getDockerEnvironmentStatus(): DockerEnvironmentStatus {
  const DOCKER_INSTALL_HINT =
    "Quick services depend on Docker. Please run curl -fsSL https://get.docker.com | sh first, and confirm systemctl enable --now docker.";
  try {
    const version = execFileSync("docker", ["--version"], {
      timeout: 5_000,
      encoding: "utf8",
    }).trim();
    execFileSync("docker", ["info"], { timeout: 10_000, stdio: "pipe" });
    return {
      available: true,
      running: true,
      version,
      message: null,
      installHint: null,
      scope: "hub-host",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const notInstalled = /ENOENT|not found|no such file/i.test(message);
    return {
      available: false,
      running: false,
      version: null,
      message: notInstalled
        ? "Docker is not installed"
        : "Docker is not running or the current user has no permission to access the Docker daemon",
      installHint: DOCKER_INSTALL_HINT,
      scope: "hub-host",
    };
  }
}

export async function getDockerEnvironmentStatusFor(
  target: DockerTarget,
): Promise<DockerEnvironmentStatus> {
  if (target.kind === "local") {
    return getDockerEnvironmentStatus();
  }
  const DOCKER_INSTALL_HINT =
    "Quick services depend on Docker. Please install Docker on the target VPS and ensure the daemon is running.";
  try {
    const { server } = await loadRemoteSshParams(target.serverId);
    const version = (await dockerExec(target, ["--version"], 10_000)).trim();
    await dockerExec(target, ["info"], 20_000);
    return {
      available: true,
      running: true,
      version,
      message: null,
      installHint: null,
      scope: "remote-vps",
      serverId: server.id,
      serverName: server.name,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      running: false,
      version: null,
      message: `Remote Docker unavailable: ${message}`,
      installHint: DOCKER_INSTALL_HINT,
      scope: "remote-vps",
      serverId: target.serverId,
    };
  }
}
