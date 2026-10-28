import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

import { t } from "@/lib/i18n/service-translations";
import { stripNul } from "@/lib/text/strip-nul";

export type SshExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  cancelled?: boolean;
  /** The remote process was not confirmed stopped; see CommandTarget.outcomeUnknown. */
  outcomeUnknown?: boolean;
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
  signal?: AbortSignal;
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

/**
 * Streaming output collector with a hard byte cap.
 *
 * Chunks are buffered as Buffers and concatenated once at settle time, so
 * appending is O(1) per chunk instead of re-copying the whole accumulated
 * string on every data event (the previous string-concat helper was O(n²)
 * for chatty commands). Cap semantics are unchanged: output is cut at
 * exactly `limitBytes` and a trailing truncation marker is appended once the
 * cap is exceeded; output that lands exactly on the cap is kept verbatim.
 */
export class BoundedOutputCollector {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private truncated = false;
  private settled: string | null = null;

  constructor(private readonly limitBytes: number) {}

  push(chunk: unknown): void {
    if (this.settled !== null || this.truncated) return;
    const buffer =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(String(chunk));
    if (buffer.length === 0) return;
    if (this.bytes >= this.limitBytes) {
      this.truncated = true;
      return;
    }
    this.chunks.push(buffer);
    this.bytes += buffer.length;
    if (this.bytes > this.limitBytes) this.truncated = true;
  }

  /** Concat + decode once; the collector is sealed afterwards. */
  finish(): string {
    if (this.settled !== null) return this.settled;
    const whole = stripNul(Buffer.concat(this.chunks).subarray(0, this.limitBytes).toString("utf8"));
    this.settled = this.truncated
      ? `${whole}\n[output truncated, exceeded ${this.limitBytes} bytes limit]`
      : whole;
    return this.settled;
  }
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
  const cancel = cancellableCommandTargets.get(targetId);
  if (cancel) return cancel();
  if (child) {
    markCommandTargetCancelled(targetId);
    return child.kill("SIGTERM");
  }
  return false;
}

export function runSshCommandProcess(input: SshCommandInput): Promise<SshExecutionResult> {
  const { command, args, env, targetId, runtimeConfig, signal } = input;
  if (signal?.aborted) return Promise.resolve({ stdout: "", stderr: "Command cancelled before dispatch", exitCode: 130, cancelled: true });
  const timeoutMs = runtimeConfig.executionTimeoutMs;
  const outputLimitBytes = runtimeConfig.outputLimitBytes;
  // Grace window between SIGTERM and SIGKILL escalation on timeout.
  const SIGKILL_GRACE_MS = 5_000;

  return new Promise<SshExecutionResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: env ?? process.env,
    });
    registerCommandChild(targetId, child);

    const stdoutCollector = new BoundedOutputCollector(outputLimitBytes);
    const stderrCollector = new BoundedOutputCollector(outputLimitBytes);
    let timedOut = false;
    let aborted = false;
    let closed = false;
    let killTimer: NodeJS.Timeout | null = null;

    const clearTimers = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancelExecution);
      unregisterCancellableTarget(targetId, cancelExecution);
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };

    const terminate = () => {
      child.kill("SIGTERM");
      if (closed) return;
      // Escalate to SIGKILL when the child survives SIGTERM (or an orphaned
      // grandchild still holds the stdio pipes), so the promise always
      // settles and no child handle leaks.
      killTimer ??= setTimeout(() => {
        if (!closed && child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, SIGKILL_GRACE_MS);
      killTimer.unref?.();
    };
    const cancelExecution = () => {
      if (closed) return false;
      aborted = true;
      terminate();
      return true;
    };
    registerCancellableTarget(targetId, cancelExecution);
    signal?.addEventListener("abort", cancelExecution, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      stderrCollector.push(`\nCommand execution exceeded ${timeoutMs}ms, terminated.`);
      terminate();
    }, timeoutMs);
    if (signal?.aborted) cancelExecution();

    child.stdout?.on("data", (chunk) => {
      stdoutCollector.push(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderrCollector.push(chunk);
    });

    child.on("error", (error) => {
      closed = true;
      clearTimers();
      unregisterCommandChild(targetId, child);
      if (targetId) consumeCommandTargetCancellation(targetId);
      if (
        command === "sshpass" &&
        error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        reject(new Error(t("backend.command.sshpassMissing")));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      closed = true;
      clearTimers();
      unregisterCommandChild(targetId, child);
      const marked = targetId ? consumeCommandTargetCancellation(targetId) : false;
      const cancelled = aborted || marked;
      if (cancelled) {
        stderrCollector.push("\nCommand has been cancelled; SSH subprocess terminated.");
      }
      // Ending the local ssh client does not stop the command on the server: without a terminal, sshd only closes the
      // pipes and the remote process runs on (measured: a `sleep` still alive, its follow-up still executed). A
      // cancelled or timed-out command is therefore of unknown outcome, so a playbook does not run it again beside the
      // one that may still be going.
      const stoppedLocallyOnly = cancelled || timedOut;
      resolve({
        stdout: stdoutCollector.finish(),
        // After the collector: its output limit must not cut the one sentence a person needs here.
        stderr: stderrCollector.finish() + (stoppedLocallyOnly ? "\nThe local SSH connection was closed; the remote process may still be running — check it before running the command again." : ""),
        exitCode: cancelled ? 130 : timedOut ? 124 : (code ?? 255),
        timedOut,
        cancelled,
        ...(stoppedLocallyOnly ? { outcomeUnknown: true } : {}),
      });
    });
  });
}
