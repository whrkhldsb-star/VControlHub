import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getCommandRuntimeConfig } from "@/lib/runtime-settings/service";
import { scanPinnedKnownHost } from "@/lib/ssh/known-hosts";
import { runSshCommandProcess, type SshExecutionResult } from "./ssh-executor";

export async function getCommandRuntimeConfigValues() {
  const config = await getCommandRuntimeConfig();
  return {
    executionTimeoutMs: config.executionTimeoutMs,
    outputLimitBytes: config.outputLimitBytes,
    staleRunningAfterMs: Math.max(config.staleRunningAfterMs, config.executionTimeoutMs),
    executionHeartbeatMs: config.executionHeartbeatMs,
  };
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
      `UserKnownHostsFile=${pin ? knownHostsPath : "/dev/null"}`,
      "-o",
      "LogLevel=ERROR",
      "-o",
      "ConnectTimeout=15",
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
      "BatchMode=yes",
      ...hostKeyMode,
      "-o",
      `UserKnownHostsFile=${pin ? knownHostsPath : "/dev/null"}`,
      "-o",
      "LogLevel=ERROR",
      "-o",
      "ConnectTimeout=15",
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
