/**
 * ssh2 in-process command executor (Windows password-auth transport).
 *
 * Windows ships OpenSSH (`ssh.exe`) but no `sshpass`, so password
 * authentication cannot ride the local-binary path there. This executor
 * reproduces `runSshCommandProcess` semantics (bounded output, timeout code
 * 124, cancel code 130, host-key pinning) over the bundled ssh2 client, so
 * callers cannot tell which transport ran.
 */
import { Client } from "ssh2";

import { createLogger } from "@/lib/logging";
import { createVerifiedSshConfig } from "@/lib/ssh/client";
import { SshHostKeyChangedError } from "@/lib/ssh/host-key";

import {
  BoundedOutputCollector,
  consumeCommandTargetCancellation,
  registerCancellableTarget,
  unregisterCancellableTarget,
  type SshExecutionResult,
} from "./ssh-executor";

const logger = createLogger("ssh2-executor");

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

/** True when the interactive challenge is exactly one hidden password prompt. */
function isSinglePasswordPrompt(
  name: string | undefined,
  prompts: Array<{ prompt?: string; echo?: boolean }> | undefined,
): boolean {
  if (!Array.isArray(prompts) || prompts.length !== 1) return false;
  const prompt = prompts[0];
  if (!prompt || prompt.echo !== false) return false;
  return /password|passwd|passphrase/i.test(`${name ?? ""} ${prompt.prompt ?? ""}`.trim());
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
      // Defense in depth: dispatch refuses unpinned targets before reaching
      // here, but a future caller must not silently fall back to TOFU.
      enforceHostKeyPin: true,
    });
    // Mirror the sshpass argv: password first, then keyboard-interactive.
    config.tryKeyboard = true;

    const client = new Client();
    let settled = false;
    let timedOut = false;
    const stdoutCollector = new BoundedOutputCollector(outputLimitBytes);
    const stderrCollector = new BoundedOutputCollector(outputLimitBytes);

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
      stderrCollector.push(`\nCommand execution exceeded ${timeoutMs}ms, terminated.`);
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
        stderrCollector.push("\nCommand has been cancelled; SSH subprocess terminated.");
        finish({
          stdout: stdoutCollector.finish(),
          stderr: stderrCollector.finish(),
          exitCode: 130,
          timedOut,
          cancelled: true,
        });
      } else if (timedOut) {
        finish({
          stdout: stdoutCollector.finish(),
          stderr: stderrCollector.finish(),
          exitCode: 124,
          timedOut: true,
        });
      } else {
        // External cancel (not via markCommandTargetCancelled): terminate like SIGKILL.
        finish({
          stdout: stdoutCollector.finish(),
          stderr: stderrCollector.finish(),
          exitCode: 137,
          cancelled: true,
        });
      }
      return true;
    };

    registerCancellableTarget(targetId, cancelExecution);

    client.on("keyboard-interactive", (name: string, _instr: string, _lang: string, prompts: Array<{ prompt?: string; echo?: boolean }>, finishAnswers: (answers: string[]) => void) => {
      // Only answer with the stored password when the server asks for exactly
      // that: one hidden prompt whose name/text is password-like. Any other
      // challenge (MFA/OTP/custom prompts) gets empty answers — replying with
      // the password would leak the credential to a non-password prompt.
      if (isSinglePasswordPrompt(name, prompts)) {
        finishAnswers([password]);
        return;
      }
      logger.warn("keyboard-interactive challenge was not a single password prompt; sent empty answers", {
        host,
        username,
        promptCount: Array.isArray(prompts) ? prompts.length : 0,
        challengeName: name ?? "",
      });
      finishAnswers((prompts ?? []).map(() => ""));
    });
    client.on("ready", () => {
      client.exec(command, (error, stream) => {
        if (error) {
          finish({ stdout: "", stderr: "", exitCode: 255, timedOut, cancelled: false });
          return;
        }
        stream.on("data", (chunk: Buffer) => {
          stdoutCollector.push(chunk);
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          stderrCollector.push(chunk);
        });
        stream.on("close", (code: number | null) => {
          const cancelled = targetId ? consumeCommandTargetCancellation(targetId) : false;
          if (cancelled) {
            stderrCollector.push("\nCommand has been cancelled; SSH subprocess terminated.");
          }
          const exitCode = cancelled ? 130 : timedOut ? 124 : (code ?? 255);
          finish({
            stdout: stdoutCollector.finish(),
            stderr: stderrCollector.finish(),
            exitCode,
            timedOut,
            cancelled,
          });
        });
        stream.on("error", () => {
          finish({
            stdout: stdoutCollector.finish(),
            stderr: stderrCollector.finish(),
            exitCode: 255,
            timedOut,
            cancelled: false,
          });
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
