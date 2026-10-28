import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { IS_WINDOWS } from "@/lib/runtime/platform-paths";

/**
 * Async wrapper around `execFile` used by the backup module to run
 * `deploy/backup.sh` (database / files / full) and `scripts/restore-db.sh`
 * plus the dedicated files/full restore scripts.
 *
 * Centralises the default 30-minute timeout and 1MB maxBuffer so the caller
 * (service.ts) does not have to re-derive the execution envelope, and keeps
 * the missing-binary detection (`bash` not installed) inside the adapter
 * rather than leaking that knowledge into every call site.
 */

const runFile = promisify(execFile);

const BACKUP_DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const BACKUP_DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;

export type RunBackupCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
  /**
   * The caller needs only the exit status (a listing that is checked, not read, such as `tar -tzf` of a backup):
   * stdout is dropped as it arrives instead of being held in memory, where more than `maxBuffer` of it (about
   * 15,000 members) used to fail the command.
   */
  discardStdout?: boolean;
};

export type RunBackupCommandInput = {
  file: string;
  args: string[];
  options?: RunBackupCommandOptions;
};

export type RunBackupCommandResult = {
  stdout: string;
  stderr: string;
};

const STDERR_KEEP_BYTES = 64 * 1024;

function runDiscardingStdout(file: string, args: string[], options: RunBackupCommandOptions): Promise<RunBackupCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: options.timeout ?? BACKUP_DEFAULT_TIMEOUT_MS,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_KEEP_BYTES) stderr += chunk.toString("utf8").slice(0, STDERR_KEEP_BYTES - stderr.length);
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve({ stdout: "", stderr });
      else reject(Object.assign(new Error(`Command failed: ${file} ${args.join(" ")}\n${stderr}`.trim()), { code: code ?? signal, stderr, killed: signal !== null }));
    });
  });
}

export async function runBackupCommand(input: RunBackupCommandInput): Promise<RunBackupCommandResult> {
  const { file, args, options = {} } = input;
  if (options.discardStdout) return runDiscardingStdout(file, args, options);
  return runFile(file, args, {
    timeout: options.timeout ?? BACKUP_DEFAULT_TIMEOUT_MS,
    maxBuffer: options.maxBuffer ?? BACKUP_DEFAULT_MAX_BUFFER_BYTES,
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
  }) as Promise<RunBackupCommandResult>;
}

export function isMissingBackupBinaryError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT";
}

export function backupCommandErrorMessage(error: unknown): string {
  if (isMissingBackupBinaryError(error)) {
    // POSIX runs deploy/backup.sh through bash; Windows runs scripts/backup.mjs
    // through the Node executable. Point the operator at whichever is missing.
    return IS_WINDOWS
      ? "The Node executable used to run scripts/backup.mjs is unavailable. Please ask the administrator to fix the service configuration and retry."
      : "bash is not installed or not in PATH. Please ask the administrator to install bash or fix PATH and retry.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Backup execution failed";
}
