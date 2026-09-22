/**
 * ssh2 in-process command executor (Windows password-auth transport).
 *
 * Windows ships OpenSSH (`ssh.exe`) but no `sshpass`, so password
 * authentication cannot ride the local-binary path there. This executor
 * reproduces `runSshCommandProcess` semantics (bounded output, timeout code
 * 124, cancel code 130, host-key pinning) over the bundled ssh2 client, so
 * callers cannot tell which transport ran.
 */
import { StringDecoder } from "node:string_decoder";

import { Client } from "ssh2";

import { createVerifiedSshConfig } from "@/lib/ssh/client";
import { SshHostKeyChangedError } from "@/lib/ssh/host-key";

import {
  appendBoundedOutput,
  consumeCommandTargetCancellation,
  registerCancellableTarget,
  unregisterCancellableTarget,
  type SshExecutionResult,
} from "./ssh-executor";

export type Ssh2ExecutionInput = {
  host: string;
  port: number;
  username: string;
  password: string;
  command: string;
  targetId?: string;
  hostKeySha256?: string | null;
  runtimeConfig: { executionTimeoutMs: number; outputLimitBytes: number };
};

function mapConnectError(error: unknown): Error {
  if (error instanceof Error && /Host key verification|host verifier/i.test(error.message)) {
    return new SshHostKeyChangedError("pinned host key", "mismatched host key presented");
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function runSsh2Command(input: Ssh2ExecutionInput): Promise<SshExecutionResult> {
  const { host, port, username, password, command, targetId, hostKeySha256 } = input;
  const timeoutMs = input.runtimeConfig.executionTimeoutMs;
  const outputLimitBytes = input.runtimeConfig.outputLimitBytes;

  return new Promise<SshExecutionResult>((resolve, reject) => {
    const config = createVerifiedSshConfig({
      host,
      port,
      username,
      password,
      hostKeySha256: hostKeySha256 ?? null,
    });
    // Mirror the sshpass argv: password first, then keyboard-interactive.
    config.tryKeyboard = true;

    const client = new Client();
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");

    const finish = (result: SshExecutionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unregisterCancellableTarget(targetId, cancelExecution);
      try {
        client.end();
      } catch {
        // Already closing — nothing to do.
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stderr = appendBoundedOutput(
        stderr,
        `\nCommand execution exceeded ${timeoutMs}ms, terminated.`,
        outputLimitBytes,
      );
      cancelExecution();
    }, timeoutMs);

    const cancelExecution = (): boolean => {
      if (settled) return false;
      try {
        client.end();
      } catch {
        // Best-effort teardown.
      }
      const cancelled = targetId ? consumeCommandTargetCancellation(targetId) : false;
      if (cancelled) {
        stderr = appendBoundedOutput(
          stderr,
          "\nCommand has been cancelled; SSH subprocess terminated.",
          outputLimitBytes,
        );
        finish({ stdout, stderr, exitCode: 130, timedOut, cancelled: true });
      } else if (timedOut) {
        finish({ stdout, stderr, exitCode: 124, timedOut: true });
      } else {
        // External cancel (not via markCommandTargetCancelled): terminate like SIGKILL.
        finish({ stdout, stderr, exitCode: 137, cancelled: true });
      }
      return true;
    };

    registerCancellableTarget(targetId, cancelExecution);

    client.on("keyboard-interactive", (_name, _instr, _lang, prompts, finish) => {
      finish(prompts.map(() => password));
    });
    client.on("ready", () => {
      client.exec(command, (error, stream) => {
        if (error) {
          finish({ stdout, stderr, exitCode: 255, timedOut, cancelled: false });
          return;
        }
        stream.on("data", (chunk: Buffer) => {
          stdout = appendBoundedOutput(stdout, stdoutDecoder.write(chunk), outputLimitBytes);
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          stderr = appendBoundedOutput(stderr, stderrDecoder.write(chunk), outputLimitBytes);
        });
        stream.on("close", (code: number | null) => {
          stdout = appendBoundedOutput(stdout, stdoutDecoder.end(), outputLimitBytes);
          stderr = appendBoundedOutput(stderr, stderrDecoder.end(), outputLimitBytes);
          const cancelled = targetId ? consumeCommandTargetCancellation(targetId) : false;
          const exitCode = cancelled ? 130 : timedOut ? 124 : (code ?? 255);
          finish({
            stdout,
            stderr: cancelled
              ? appendBoundedOutput(
                  stderr,
                  "\nCommand has been cancelled; SSH subprocess terminated.",
                  outputLimitBytes,
                )
              : stderr,
            exitCode,
            timedOut,
            cancelled,
          });
        });
        stream.on("error", () => {
          finish({ stdout, stderr, exitCode: 255, timedOut, cancelled: false });
        });
      });
    });
    client.on("error", (error) => {
      if (settled) return;
      clearTimeout(timer);
      unregisterCancellableTarget(targetId, cancelExecution);
      reject(mapConnectError(error));
    });
    client.connect(config);
  });
}
