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

export function appendBoundedOutput(current: string, chunk: unknown, limitBytes: number): string {
  if (Buffer.byteLength(current, "utf8") >= limitBytes) return current;
  const next = Buffer.concat([Buffer.from(current), Buffer.from(String(chunk))]);
  if (next.byteLength <= limitBytes) return next.toString("utf8");
  return `${next.subarray(0, limitBytes).toString("utf8")}\n[输出已截断，超过 ${limitBytes} 字节限制]`;
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

export function markCommandTargetCancelled(targetId: string): void {
  cancelledCommandTargets.add(targetId);
}

export function cancelRunningCommandChild(targetId: string): boolean {
  const child = activeCommandChildren.get(targetId);
  if (!child) return false;
  return child.kill("SIGTERM");
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
      stderr = appendBoundedOutput(stderr, `\n命令执行超过 ${timeoutMs}ms，已终止。`, outputLimitBytes);
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
            "密码连接需要 sshpass 工具，但系统未安装 sshpass。请安装 sshpass 或改用 SSH 密钥连接。",
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      unregisterCommandChild(targetId, child);
      const cancelled = targetId ? cancelledCommandTargets.delete(targetId) : false;
      resolve({
        stdout,
        stderr: cancelled ? appendBoundedOutput(stderr, "\n命令已被取消，SSH 子进程已终止。", outputLimitBytes) : stderr,
        exitCode: cancelled ? 130 : timedOut ? 124 : (code ?? 255),
        timedOut,
        cancelled,
      });
    });
  });
}
