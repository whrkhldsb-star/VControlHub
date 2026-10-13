/**
 * Docker CLI adapter for Quick Services.
 *
 * Local (hub-host) keeps the historical sync helpers used by unit tests.
 * Remote VPS installs go through SSH (`execRemoteCommand`) via the async
 * target-aware helpers.
 */
import { execFile, execFileSync, spawnSync } from "child_process";
import { getRuntimeSettingNumberCached } from "@/lib/runtime-settings/cached";
import { promisify } from "util";

import { BusinessError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import { serviceT } from "@/lib/i18n/service-locale";
import { t } from "@/lib/i18n/service-translations";
import { shellQuote } from "@/lib/shell-quote";
import { isValidTcpPort } from "@/lib/runtime/listen-port";
import { loadEnabledServerForSsh } from "@/lib/ssh/server-target";
import { execRemoteCommand } from "@/lib/ssh/client";

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

function buildDockerCommand(args: string[]): string {
  return ["docker", ...args.map(shellQuote)].join(" ");
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
  const { server, ssh } = await loadEnabledServerForSsh(target.serverId);
  const command = buildDockerCommand(args);
  logger.debug("remote docker exec", {
    serverId: server.id,
    serverName: server.name,
    args: args.slice(0, 6),
  });
  const result = await execRemoteCommand({
    ...ssh,
    command,
    timeout: timeoutMs,
  });
  if (result.exitCode !== 0 && result.exitCode !== null) {
    const msg = (result.stderr || result.stdout || `exit ${result.exitCode}`).trim();
    throw new BusinessError(msg || `Remote docker failed on ${server.name}`);
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
  const { server, ssh } = await loadEnabledServerForSsh(target.serverId);
  const result = await execRemoteCommand({
    ...ssh,
    command: buildDockerCommand(args),
    timeout: timeoutMs,
  });
  if (result.exitCode !== 0 && result.exitCode !== null) {
    const msg = (result.stderr || result.stdout || `exit ${result.exitCode}`).trim();
    throw new BusinessError(msg || `Remote docker run failed on ${server.name}`);
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
  if (!isValidTcpPort(port)) return false;
  const { server, ssh } = await loadEnabledServerForSsh(serverId);
  const command =
    `PORT=${port}; ` +
    `if command -v ss >/dev/null 2>&1; then ` +
    `ss -tlnH 2>/dev/null | awk '{print $4}' | grep -E "[:.]$PORT$" >/dev/null && exit 1 || exit 0; ` +
    `elif command -v bash >/dev/null 2>&1; then ` +
    `bash -c "echo >/dev/tcp/127.0.0.1/$PORT" >/dev/null 2>&1 && exit 1 || exit 0; ` +
    `else exit 0; fi`;
  const result = await execRemoteCommand({
    ...ssh,
    command,
    timeout: 10_000,
  });
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

export function parseRemoteListeningPorts(output: string): number[] {
  const ports = output
    .split(/\r?\n/)
    .map((endpoint) => endpoint.trim().match(/[:.](\d+)$/)?.[1])
    .map(Number)
    .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65_535);
  return [...new Set(ports)].sort((a, b) => a - b);
}

/** List TCP listen ports on a remote VPS with one SSH round-trip. */
export async function getRemoteUsedPorts(serverId: string): Promise<number[]> {
  const { server, ssh } = await loadEnabledServerForSsh(serverId);
  const command =
    `if command -v ss >/dev/null 2>&1; then ` +
    `ss -tlnH 2>/dev/null | awk '{print $4}'; ` +
    `elif command -v netstat >/dev/null 2>&1; then ` +
    `netstat -tln 2>/dev/null | awk 'NR > 2 {print $4}'; ` +
    `fi`;
  const result = await execRemoteCommand({
    ...ssh,
    command,
    timeout: 10_000,
  });
  if (result.exitCode !== 0 && result.exitCode !== null) {
    logger.warn("remote listening-port inventory failed", {
      serverId: server.id,
      exitCode: result.exitCode,
      stderr: (result.stderr || "").slice(0, 200),
    });
    return [];
  }
  return parseRemoteListeningPorts(result.stdout);
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

/**
 * True only for Docker's own "this container does not exist" answer. Every
 * other failure (daemon down, SSH lost, permission denied, timeout) means the
 * container's state is unknown and must not be treated as "absent".
 */
export function isDockerNoSuchContainerError(error: unknown): boolean {
  return /no such (?:object|container)/i.test(dockerErrorMessage(error));
}

/**
 * Timing of the post-start acceptance check. Mutable so tests can shorten it;
 * production keeps the defaults.
 */
export const containerHealthGate = { settleMs: 5_000, pollMs: 2_000, timeoutMs: 90_000 };
const DEFAULT_HEALTH_GATE_TIMEOUT_MS = containerHealthGate.timeoutMs;
/** The `quickService.healthGateTimeoutMs` setting, unless a test shortened the gate. */
function healthGateTimeoutMs() {
  return containerHealthGate.timeoutMs === DEFAULT_HEALTH_GATE_TIMEOUT_MS
    ? getRuntimeSettingNumberCached("quickService.healthGateTimeoutMs")
    : containerHealthGate.timeoutMs;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ContainerRuntimeState = { status: string; health: string; restarts: number };

async function inspectContainerRuntimeState(target: DockerTarget, containerName: string): Promise<ContainerRuntimeState> {
  const raw = (
    await dockerExec(
      target,
      ["inspect", "--format={{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}", containerName],
      10_000,
    )
  ).trim();
  const [status = "", health = "", restarts = "0"] = raw.split("|");
  return { status, health, restarts: Number.parseInt(restarts, 10) || 0 };
}

/**
 * Acceptance check after `docker run`: `run -d` succeeds as soon as the
 * container is created, even when the process exits a second later. The
 * container must still be running after a settle period, must not have
 * restarted, and must not report an unhealthy healthcheck; a healthcheck that
 * is still "starting" is waited for up to the timeout and then reported as
 * pending rather than failed (slow first starts are normal). Returns the
 * observed health ("healthy", "starting", or "running" without a healthcheck).
 */
export async function assertContainerStarted(target: DockerTarget, containerName: string): Promise<string> {
  const deadline = Date.now() + healthGateTimeoutMs();
  await sleep(containerHealthGate.settleMs);
  for (;;) {
    const state = await inspectContainerRuntimeState(target, containerName);
    if (state.status !== "running") {
      throw new BusinessError(t("backend.quick-service.containerNotRunningAfterStart", { name: containerName, status: state.status || "unknown" }));
    }
    if (state.restarts > 0) {
      throw new BusinessError(t("backend.quick-service.containerRestartedAfterStart", { name: containerName, count: state.restarts }));
    }
    if (state.health === "unhealthy") {
      throw new BusinessError(t("backend.quick-service.containerUnhealthy", { name: containerName }));
    }
    if (state.health === "healthy") return "healthy";
    if (!state.health) {
      // No healthcheck: one more look after a second settle period catches a
      // process that dies shortly after start.
      if (Date.now() >= deadline) return "running";
      await sleep(containerHealthGate.settleMs);
      const again = await inspectContainerRuntimeState(target, containerName);
      if (again.status !== "running" || again.restarts > 0) {
        throw new BusinessError(t("backend.quick-service.containerStoppedAfterStart", { name: containerName, status: again.status || "unknown", count: again.restarts }));
      }
      return "running";
    }
    if (Date.now() >= deadline) return state.health;
    await sleep(containerHealthGate.pollMs);
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
    const { ssh } = await loadEnabledServerForSsh(target.serverId);
    const command = `${buildDockerCommand(["logs", "--tail", "20", containerName])} 2>&1`;
    const result = await execRemoteCommand({
      ...ssh,
      command,
      timeout: timeoutMs,
    });
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

/** Local async status (route-facing preflight; used by tests + local install preflight). */
export async function getDockerEnvironmentStatus(): Promise<DockerEnvironmentStatus> {
  // Locale-aware t: the static service dictionary defaults to zh, which
  // leaked Chinese copy into EN-locale API responses.
  const t = await serviceT();
  const dockerInstallHint = t("backend.quick-service.dockerInstallHintLocal");
  try {
    const { stdout } = await runFile("docker", ["--version"], {
      timeout: 5_000,
      encoding: "utf8",
    });
    await runFile("docker", ["info"], { timeout: 10_000, encoding: "utf8" });
    return {
      available: true,
      running: true,
      version: String(stdout).trim(),
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
        ? t("backend.quick-service.dockerNotInstalled")
        : t("backend.quick-service.dockerNotRunning"),
      installHint: dockerInstallHint,
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
  const t = await serviceT();
  const dockerInstallHint = t("backend.quick-service.dockerInstallHintRemote");
  try {
    const { server } = await loadEnabledServerForSsh(target.serverId);
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
      message: t("backend.quick-service.dockerUnavailableRemote", { message }),
      installHint: dockerInstallHint,
      scope: "remote-vps",
      serverId: target.serverId,
    };
  }
}
