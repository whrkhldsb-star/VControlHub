import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getCommandRuntimeConfig } from "@/lib/runtime-settings/service";
import { IS_WINDOWS, NULL_DEVICE } from "@/lib/runtime/platform-paths";
import { scanPinnedKnownHost } from "@/lib/ssh/known-hosts";
import { runSshCommandProcess, type SshExecutionResult } from "./ssh-executor";
import { runSsh2Command } from "./ssh2-executor";

export async function getCommandRuntimeConfigValues() {
  const config = await getCommandRuntimeConfig();
  return {
    executionTimeoutMs: config.executionTimeoutMs,
    outputLimitBytes: config.outputLimitBytes,
    staleRunningAfterMs: Math.max(config.staleRunningAfterMs, config.executionTimeoutMs),
    executionHeartbeatMs: config.executionHeartbeatMs,
  };
}

/**
 * Windows ships `ssh.exe` but no `sshpass`, so password-authenticated command
 * execution rides the in-process ssh2 transport there. POSIX keeps the exact
 * local-binary argv (sshpass + ssh) existing deployments and tests expect.
 * The override lets tests pin a transport and ops force one deliberately.
 */
export type PasswordExecutorMode = "auto" | "sshpass" | "ssh2";

let passwordExecutorMode: PasswordExecutorMode = "auto";

export function setPasswordExecutorMode(mode: PasswordExecutorMode): void {
  passwordExecutorMode = mode;
}

export function shouldUseSsh2PasswordExecutor(): boolean {
  if (passwordExecutorMode === "ssh2") return true;
  if (passwordExecutorMode === "sshpass") return false;
  return IS_WINDOWS;
}

type SshTargetInput = {
  host: string;
  port: number;
  username: string;
  hostKeySha256?: string | null;
};

/**
 * Stage the pinned known_hosts file inside one temp dir. Returns the
 * trimmed pin fingerprint (empty when unpinned) and the file path ¡ª the
 * same pair every local-binary ssh invocation needs.
 */
async function stagePinnedKnownHosts(
  tempDir: string,
  target: SshTargetInput,
): Promise<{ pin: string | undefined; knownHostsPath: string }> {
  const knownHostsPath = join(tempDir, "known_hosts");
  const pin = target.hostKeySha256?.trim();
  if (pin) {
    const knownHostLine = await scanPinnedKnownHost({
      host: target.host,
      port: target.port,
      expectedFingerprint: pin,
    });
    await writeFile(knownHostsPath, `${knownHostLine}\n`, { mode: 0o600 });
  }
  return { pin, knownHostsPath };
}

/** Strict pinning when a fingerprint is known; accept-new for bootstrap connections. */
function hostKeyModeFlags(pin: string | undefined): string[] {
  return pin ? ["-o", "StrictHostKeyChecking=yes"] : ["-o", "StrictHostKeyChecking=accept-new"];
}

/**
 * Option spine shared by every local ssh invocation: host-key mode, the
 * known-hosts sink (pinned file or the platform null device), quiet logs, a
 * bounded connect timeout, and the `--` destination guard. `--` terminates
 * ssh option parsing: without it, a destination that begins with `-`
 * (e.g. a maliciously-set username `-oProxyCommand=¡­`) would be parsed as a
 * local ssh option ¡ú arbitrary command execution on the control-plane host.
 * Charset validation at the schema layer is the primary guard; this is
 * defense-in-depth for any pre-existing rows.
 */
function buildSshCommonArgs(target: SshTargetInput, pinned: { pin: string | undefined; knownHostsPath: string }): string[] {
  return [
    ...hostKeyModeFlags(pinned.pin),
    "-o",
    `UserKnownHostsFile=${pinned.pin ? pinned.knownHostsPath : NULL_DEVICE}`,
    "-o",
    "LogLevel=ERROR",
    "-o",
    "ConnectTimeout=15",
    "--",
    `${target.username}@${target.host}`,
  ];
}

/** Per-use temp dir that is always removed, even when the executor rejects. */
async function withSshTempDir<T>(prefix: string, run: (tempDir: string) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function executeCommandOverSshWithKey(input: {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  command: string;
  targetId?: string;
  hostKeySha256?: string | null;
}): Promise<SshExecutionResult> {
  return withSshTempDir("app-ssh-", async (tempDir) => {
    const keyPath = join(tempDir, "id_key");
    await writeFile(keyPath, `${input.privateKey.trim()}\n`, { mode: 0o600 });
    const pinned = await stagePinnedKnownHosts(tempDir, input);
    const args = [
      "-i",
      keyPath,
      "-p",
      String(input.port),
      "-o",
      "BatchMode=yes",
      ...buildSshCommonArgs(input, pinned),
      input.command,
    ];
    return await runSshCommandProcess({
      command: "ssh",
      args,
      env: process.env,
      targetId: input.targetId,
      runtimeConfig: await getCommandRuntimeConfigValues(),
    });
  });
}

async function executeCommandOverSshWithPassword(input: {
  host: string;
  port: number;
  username: string;
  password: string;
  command: string;
  targetId?: string;
  hostKeySha256?: string | null;
}): Promise<SshExecutionResult> {
  if (shouldUseSsh2PasswordExecutor()) {
    return runSsh2Command({
      host: input.host,
      port: input.port,
      username: input.username,
      password: input.password,
      command: input.command,
      targetId: input.targetId,
      hostKeySha256: input.hostKeySha256 ?? null,
      runtimeConfig: await getCommandRuntimeConfigValues(),
    });
  }
  return withSshTempDir("app-ssh-known-hosts-", async (tempDir) => {
    const pinned = await stagePinnedKnownHosts(tempDir, input);
    const args = [
      "-p",
      String(input.port),
      "-o",
      "BatchMode=no",
      "-o",
      "PreferredAuthentications=password,keyboard-interactive",
      "-o",
      "PubkeyAuthentication=no",
      "-o",
      "NumberOfPasswordPrompts=1",
      ...buildSshCommonArgs(input, pinned),
      input.command,
    ];
    return await runSshCommandProcess({
      command: "sshpass",
      args: ["-e", "ssh", ...args],
      env: { ...process.env, SSHPASS: input.password },
      targetId: input.targetId,
      runtimeConfig: await getCommandRuntimeConfigValues(),
    });
  });
}

export async function executeCommandOverSsh(input: {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  command: string;
  targetId?: string;
  hostKeySha256?: string | null;
}): Promise<SshExecutionResult> {
  if (input.privateKey) {
    return executeCommandOverSshWithKey(input as Parameters<typeof executeCommandOverSshWithKey>[0]);
  }
  if (input.password) {
    return executeCommandOverSshWithPassword(
      input as Parameters<typeof executeCommandOverSshWithPassword>[0],
    );
  }
  throw new Error("Missing SSH credentials (private key or password)");
}
