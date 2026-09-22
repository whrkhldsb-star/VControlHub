import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getCommandRuntimeConfig } from "@/lib/runtime-settings/service";
import { NULL_DEVICE } from "@/lib/runtime/platform-paths";
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
  return process.platform === "win32";
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
  const tempDir = await mkdtemp(join(tmpdir(), "app-ssh-"));
  const keyPath = join(tempDir, "id_key");
  const knownHostsPath = join(tempDir, "known_hosts");
  try {
    await writeFile(keyPath, `${input.privateKey.trim()}\n`, { mode: 0o600 });
    const pin = input.hostKeySha256?.trim();
    if (pin) {
      const knownHostLine = await scanPinnedKnownHost({
        host: input.host,
        port: input.port,
        expectedFingerprint: pin,
      });
      await writeFile(knownHostsPath, `${knownHostLine}\n`, { mode: 0o600 });
    }
    const hostKeyMode = pin
      ? (["-o", "StrictHostKeyChecking=yes"] as const)
      : (["-o", "StrictHostKeyChecking=accept-new"] as const);
    const args = [
      "-i",
      keyPath,
      "-p",
      String(input.port),
      "-o",
      "BatchMode=yes",
      ...hostKeyMode,
      "-o",
      `UserKnownHostsFile=${pin ? knownHostsPath : NULL_DEVICE}`,
      "-o",
      "LogLevel=ERROR",
      "-o",
      "ConnectTimeout=15",
      // `--` terminates ssh option parsing: without it, a destination that
      // begins with `-` (e.g. a maliciously-set username `-oProxyCommand=â€¦`)
      // would be parsed as a local ssh option â†?arbitrary command execution on
      // the control-plane host. Charset validation at the schema layer is the
      // primary guard; this is defense-in-depth for any pre-existing rows.
      "--",
      `${input.username}@${input.host}`,
      input.command,
    ];
    return await runSshCommandProcess({
      command: "ssh",
      args,
      env: process.env,
      targetId: input.targetId,
      runtimeConfig: await getCommandRuntimeConfigValues(),
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
  const tempDir = await mkdtemp(join(tmpdir(), "app-ssh-known-hosts-"));
  const knownHostsPath = join(tempDir, "known_hosts");
  const pin = input.hostKeySha256?.trim();
  try {
    if (pin) {
      const knownHostLine = await scanPinnedKnownHost({
        host: input.host,
        port: input.port,
        expectedFingerprint: pin,
      });
      await writeFile(knownHostsPath, `${knownHostLine}\n`, { mode: 0o600 });
    }
    const hostKeyMode = pin
      ? (["-o", "StrictHostKeyChecking=yes"] as const)
      : (["-o", "StrictHostKeyChecking=accept-new"] as const);
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
      ...hostKeyMode,
      "-o",
      `UserKnownHostsFile=${pin ? knownHostsPath : NULL_DEVICE}`,
      "-o",
      "LogLevel=ERROR",
      "-o",
      "ConnectTimeout=15",
      // See the key-auth path: `--` terminates option parsing so a `-`-leading
      // destination cannot be reinterpreted as a local ssh option.
      "--",
      `${input.username}@${input.host}`,
      input.command,
    ];
    return await runSshCommandProcess({
      command: "sshpass",
      args: ["-e", "ssh", ...args],
      env: { ...process.env, SSHPASS: input.password },
      targetId: input.targetId,
      runtimeConfig: await getCommandRuntimeConfigValues(),
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
