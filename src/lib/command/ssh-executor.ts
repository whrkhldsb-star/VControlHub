import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

export type SshExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  cancelled?: boolean;
};

export type SshRuntimeConfig = {
  executionTimeoutMs: number;
  outputLimitBytes: number;
};

export type SshCommandInput = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  targetId?: string;
  runtimeConfig: SshRuntimeConfig;
};

const activeCommandChildren = new Map<string, ChildProcess>();
const cancelledCommandTargets = new Set<string>();
/**
 * Non-child-process executions (ssh2 in-process transport on Windows) register
 * a cancel callback under the same target id so `cancelRunningCommandChild`
 * stays the single cancellation entry point for the command module.
 */
const cancellableCommandTargets = new Map<string, () => boolean>();

export function appendBoundedOutput(current: string, chunk: unknown, limitBytes: number): string {
  if (Buffer.byteLength(current, "utf8") >= limitBytes) return current;
  const next = Buffer.concat([Buffer.from(current), Buffer.from(String(chunk))]);
  if (next.byteLength <= limitBytes) return next.toString("utf8");
  return `${next.subarray(0, limitBytes).toString("utf8")}\n[output truncated, exceeded ${limitBytes} bytes limit]`;
}

function registerCommandChild(targetId: string | undefined, child: ChildProcess) {
  if (!targetId) return;
  activeCommandChildren.set(targetId, child);
}

function unregisterCommandChild(targetId: string | undefined, child: ChildProcess) {
  if (!targetId) return;
  if (activeCommandChildren.get(targetId) === child) {
    activeCommandChildren.delete(targetId);
  }
}

export function registerCancellableTarget(targetId: string | undefined, cancel: () => boolean) {
  if (!targetId) return;
  cancellableCommandTargets.set(targetId, cancel);
}

export function unregisterCancellableTarget(targetId: string | undefined, cancel: () => boolean) {
  if (!targetId) return;
  if (cancellableCommandTargets.get(targetId) === cancel) {
    cancellableCommandTargets.delete(targetId);
  }
}

export function markCommandTargetCancelled(targetId: string): void {
  cancelledCommandTargets.add(targetId);
}

export function consumeCommandTargetCancellation(targetId: string): boolean {
  return cancelledCommandTargets.delete(targetId);
}

export function cancelRunningCommandChild(targetId: string): boolean {
  const child = activeCommandChildren.get(targetId);
  if (child) return child.kill("SIGTERM");
  const cancel = cancellableCommandTargets.get(targetId);
  if (cancel) return cancel();
  return false;
}

export function runSshCommandProcess(input: SshCommandInput): Promise<SshExecutionResult> {
  const { command, args, env, targetId, runtimeConfig } = input;
  const timeoutMs = runtimeConfig.executionTimeoutMs;
  const outputLimitBytes = runtimeConfig.outputLimitBytes;

  return new Promise<SshExecutionResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: env ?? process.env,
    });
    registerCommandChild(targetId, child);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      stderr = appendBoundedOutput(stderr, `\nCommand execution exceeded ${timeoutMs}ms, terminated.`, outputLimitBytes);
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout = appendBoundedOutput(stdout, chunk, outputLimitBytes);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendBoundedOutput(stderr, chunk, outputLimitBytes);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      unregisterCommandChild(targetId, child);
      if (
        command === "sshpass" &&
        error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        reject(
          new Error(
            "Password connection requires the sshpass tool, but sshpass is not installed on the system. Please install sshpass or switch to SSH key connection.",
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      unregisterCommandChild(targetId, child);
      const cancelled = targetId ? consumeCommandTargetCancellation(targetId) : false;
      resolve({
        stdout,
        stderr: cancelled ? appendBoundedOutput(stderr, "\nCommand has been cancelled; SSH subprocess terminated.", outputLimitBytes) : stderr,
        exitCode: cancelled ? 130 : timedOut ? 124 : (code ?? 255),
        timedOut,
        cancelled,
      });
    });
  });
}
