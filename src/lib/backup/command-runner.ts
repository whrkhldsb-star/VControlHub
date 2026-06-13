import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Async wrapper around `execFile` used by the backup module to run
 * `deploy/backup.sh` (database / files / full) and `scripts/restore-db.sh`
 * (database restore) plus `tar -xzf` (files / full restore).
 *
 * Centralises the default 30-minute timeout and 1MB maxBuffer so the caller
 * (service.ts) does not have to re-derive the execution envelope, and keeps
 * the missing-binary detection (`bash` not installed) inside the adapter
 * rather than leaking that knowledge into every call site.
 */

const runFile = promisify(execFile);

export const BACKUP_DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
export const BACKUP_DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;

export type RunBackupCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
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

export async function runBackupCommand(input: RunBackupCommandInput): Promise<RunBackupCommandResult> {
  const { file, args, options = {} } = input;
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
    return "bash 未安装或不在 PATH，请联系管理员安装 bash 或修复 PATH 后重试。";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "备份执行失败";
}
