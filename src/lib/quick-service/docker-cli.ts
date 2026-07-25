/**
 * Docker CLI adapter for Quick Services.
 *
 * Local (hub-host) keeps the historical sync helpers used by unit tests.
 * Remote VPS installs go through SSH (`execRemoteCommand`) via the async
 * target-aware helpers.
 */
import { execFile, execFileSync, spawnSync } from "child_process";
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


/** Probe whether a TCP port is free on a remote VPS (ss via SSH). */
export async function isRemotePortAvailable(serverId: string, port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  const { server, ssh } = await loadRemoteSshParams(serverId);
  const command =
    `PORT=${port}; ` +
    `if command -v ss >/dev/null 2>&1; then ` +
    `ss -tlnH 2>/dev/null | awk '{print $4}' | grep -E "[:.]$PORT$" >/dev/null && exit 1 || exit 0; ` +
    `elif command -v bash >/dev/null 2>&1; then ` +
    `bash -c "echo >/dev/tcp/127.0.0.1/$PORT" >/dev/null 2>&1 && exit 1 || exit 0; ` +
    `else exit 0; fi`;
  const result = await execRemoteCommand({
    ...(ssh as object),
    command,
    timeout: 10_000,
  } as Parameters<typeof execRemoteCommand>[0]);
  // exit 0 = free, exit 1 = in use
  if (result.exitCode === 1) return false;
  if (result.exitCode === 0) return true;
  // Ambiguous remote tooling failure — do not block install; docker bind will fail closed.
  logger.warn("remote port probe inconclusive", {
    serverId: server.id,
    port,
    exitCode: result.exitCode,
    stderr: (result.stderr || "").slice(0, 200),
  });
  return true;
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
    // docker logs splits container stdout/stderr onto process streams; capture both.
    const result = spawnSync("docker", ["logs", "--tail", "20", containerName], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (result.error) return null;
    const logs = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
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
    if (target.kind === "local") {
      return getContainerLogTail(containerName, timeoutMs);
    }
    // Remote path: dockerExec only returns stdout; append 2>&1 so stderr is captured.
    const { server, ssh } = await loadRemoteSshParams(target.serverId);
    const command = `${buildDockerCommand(["logs", "--tail", "20", containerName])} 2>&1`;
    const result = await execRemoteCommand({
      ...(ssh as object),
      command,
      timeout: timeoutMs,
    } as Parameters<typeof execRemoteCommand>[0]);
    // logs may exit non-zero when container missing; still return any captured text
    const logs = (result.stdout || result.stderr || "").trim();
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
