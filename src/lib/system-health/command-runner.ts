import { execFile } from "node:child_process";

export const HEALTH_CHECK_DEFAULT_TIMEOUT_MS = 5000;

export type RunHealthCheckCommandInput = {
  file: string;
  args: string[];
  options?: { timeoutMs?: number };
};

export type RunHealthCheckCommandResult = string | null;

/**
 * Execute a short-lived health check command (e.g. `systemctl is-active`,
 * `git rev-parse`) and return its trimmed stdout, or `null` when it could not
 * be run or gave no answer (missing binary, timeout, a failure that printed
 * nothing). System-health callers always coerce unknown failures to `null` so
 * the report can degrade gracefully, so the adapter swallows the raw error.
 *
 * A command that ran and exited non-zero still counts when it printed
 * something: `systemctl is-active` exits 3 for "inactive" and "failed" and
 * 4 for a missing unit, and what it prints is the answer. Dropping it made a
 * stopped service read as "status temporarily unreadable" (a warning).
 *
 * Async on purpose: this runs inside request paths (`/api/system-health`), and
 * `git ls-remote` can hang for seconds on a slow network — a synchronous
 * execFile would block the Node event loop for every concurrent request.
 */
export async function runHealthCheckCommand(input: RunHealthCheckCommandInput): Promise<RunHealthCheckCommandResult> {
  const { file, args, options } = input;
  const timeoutMs = options?.timeoutMs ?? HEALTH_CHECK_DEFAULT_TIMEOUT_MS;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(file, args, { encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL" }, (error, out) => {
        // Killed by the timeout or never started: no answer. Exited by itself with output: that is the answer.
        if (error && (error.killed || typeof error.code !== "number" || !String(out ?? "").trim())) reject(error);
        else resolve(out);
      });
    });
    return stdout.trim();
  } catch {
    return null;
  }
}
