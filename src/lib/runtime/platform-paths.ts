/**
 * Cross-platform path / endpoint defaults.
 *
 * Production historically ran on Debian/Ubuntu, so several defaults were
 * hard-coded POSIX paths (`/tmp/...`, `/var/lib/...`, `/var/run/docker.sock`).
 * The helpers below keep the POSIX values byte-identical on Linux while
 * resolving native Windows equivalents, so existing Linux deployments are
 * unaffected.
 */
import { access, constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const IS_WINDOWS = process.platform === "win32";

/**
 * Null device used for OpenSSH `UserKnownHostsFile=` and similar sink paths.
 * Windows OpenSSH resolves the DOS device name `NUL`; POSIX uses /dev/null.
 */
export const NULL_DEVICE = IS_WINDOWS ? "NUL" : "/dev/null";

/**
 * Resolve an executable without spawning a shell.
 *
 * Bare names are searched across PATH with the platform executable
 * extensions (`.exe`/`.com` on Windows). Absolute/relative candidates are
 * checked as-is. Returns the first existing hit, or null when nothing
 * resolves. Heavier needs (extra search roots, `.bat`/`.cmd`) belong to the
 * standalone `scripts/lib/backup-common.mjs` runner, not app code.
 */
export async function findExecutable(command: string): Promise<string | null> {
  if (command.includes("/") || command.includes("\\")) {
    return (await pathExists(command)) ? command : null;
  }
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const candidates = IS_WINDOWS ? [command, `${command}.exe`, `${command}.com`] : [command];
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (await pathExists(full)) return full;
    }
  }
  return null;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Read the platform live (mockable in tests, unlike the IS_WINDOWS const). */
function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Local aria2 relay scratch directory: a relay download lands here before it
 * is uploaded to the target server over SFTP.
 *
 * POSIX keeps the historical `/tmp` path. Windows cannot use it literally —
 * both Node and aria2c resolve a leading `/` against the current drive
 * (`E:\tmp\...`), which drifts with whatever drive the process happens to
 * start from — so the per-user temp directory is used instead.
 */
export function relayTempDir(taskId: string): string {
  return isWindows()
    ? path.join(os.tmpdir(), `app-relay-${taskId}`)
    : `/tmp/app-relay-${taskId}`;
}

/**
 * Root for app-managed state blobs when no env override is configured.
 * POSIX keeps `/var/lib/vcontrolhub`; Windows uses the machine-wide Program
 * Data directory (callers create it on demand).
 */
export function defaultDataRoot(): string {
  return isWindows()
    ? path.join(
        process.env.PROGRAMDATA ?? path.join(os.homedir(), "AppData", "Local"),
        "VControlHub",
      )
    : "/var/lib/vcontrolhub";
}

export type DockerEngineEndpoint =
  | { kind: "socket"; socketPath: string }
  | { kind: "tcp"; host: string; port: number };

/**
 * Docker Engine endpoint for the hub-host scope.
 *
 * - POSIX default: the historical `/var/run/docker.sock` unix socket.
 * - Windows default: Docker Desktop's named pipe. Node's `http.request`
 *   accepts named pipes through `socketPath` on Windows.
 * - `DOCKER_HOST` wins when set, so rootless / remote / TCP daemons work on
 *   any platform (`unix://`, `npipe://`, `tcp://`).
 */
export function dockerEngineEndpoint(): DockerEngineEndpoint {
  const dockerHost = process.env.DOCKER_HOST?.trim();
  if (dockerHost) {
    if (dockerHost.startsWith("unix:")) {
      return { kind: "socket", socketPath: dockerHost.slice("unix://".length) };
    }
    if (dockerHost.startsWith("npipe:")) {
      // npipe:////./pipe/docker_engine → \\.\pipe\docker_engine
      const raw = dockerHost.slice("npipe://".length);
      return { kind: "socket", socketPath: raw.replace(/\//g, "\\") };
    }
    if (dockerHost.startsWith("tcp:")) {
      try {
        const url = new URL(dockerHost);
        return {
          kind: "tcp",
          host: url.hostname || "127.0.0.1",
          port: url.port ? Number(url.port) : 2375,
        };
      } catch {
        // Malformed DOCKER_HOST — fall through to the platform default.
      }
    }
  }
  return isWindows()
    ? { kind: "socket", socketPath: "\\\\.\\pipe\\docker_engine" }
    : { kind: "socket", socketPath: "/var/run/docker.sock" };
}

/** Socket path only (display metadata / scope descriptors). */
export function dockerEngineSocketPath(): string {
  const endpoint = dockerEngineEndpoint();
  if (endpoint.kind === "socket") return endpoint.socketPath;
  return `tcp://${endpoint.host}:${endpoint.port}`;
}

/**
 * Host-side bind for templates that mount the control-plane Docker socket.
 * Templates declare the POSIX literal (`/var/run/docker.sock`); Docker
 * Desktop on Windows cannot mount it and needs the named pipe instead. The
 * container side stays POSIX either way.
 */
export function hubHostDockerSocketMount(): string {
  return IS_WINDOWS ? "\\\\.\\pipe\\docker_engine" : "/var/run/docker.sock";
}
