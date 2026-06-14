import { execFileSync } from "node:child_process";

export const HEALTH_CHECK_DEFAULT_TIMEOUT_MS = 5000;

export type RunHealthCheckCommandInput = {
  file: string;
  args: string[];
  options?: { timeoutMs?: number };
};

export type RunHealthCheckCommandResult = string | null;

/**
 * Execute a short-lived health check command (e.g. `systemctl is-active`,
 * `git rev-parse`) and return its trimmed stdout, or `null` on any error
 * (missing binary, non-zero exit, timeout). System-health callers always
 * coerce unknown failures to `null` so the report can degrade gracefully,
 * so the adapter swallows the raw error.
 */
export function runHealthCheckCommand(input: RunHealthCheckCommandInput): RunHealthCheckCommandResult {
  const { file, args, options } = input;
  const timeoutMs = options?.timeoutMs ?? HEALTH_CHECK_DEFAULT_TIMEOUT_MS;
  try {
    return execFileSync(file, args, { encoding: "utf8", timeout: timeoutMs }).trim();
  } catch {
    return null;
  }
}
