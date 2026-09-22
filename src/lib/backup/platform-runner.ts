/**
 * Backup/restore command dispatch per platform.
 *
 * POSIX keeps the battle-tested bash scripts (deploy/backup.sh +
 * scripts/restore-*.sh). Windows — where the deployment has no bash and no
 * GNU toolchain guarantee — runs the Node implementations (scripts/backup.mjs
 * + scripts/restore.mjs) through the current Node executable, so services
 * never depend on `node` being on PATH.
 *
 * Every caller that builds backup/restore argv (the runtime executor in
 * service-runtime.ts, the command planners in service-commands.ts, and their
 * tests) resolves its entrypoint here so the two platforms cannot drift.
 */
import { IS_WINDOWS } from "@/lib/runtime/platform-paths";
import type { BackupType } from "./service-types";

export type RunnerSpec = { file: string; script: string };

/** Entry point that produces a new backup artifact. */
export function backupRunnerSpec(): RunnerSpec {
  return IS_WINDOWS
    ? { file: process.execPath, script: "scripts/backup.mjs" }
    : { file: "bash", script: "deploy/backup.sh" };
}

/**
 * Entry point that restores one. POSIX picks the per-type bash script;
 * Windows dispatches inside scripts/restore.mjs on the component argument.
 */
export function restoreRunnerSpec(type: BackupType = "DATABASE"): RunnerSpec {
  if (IS_WINDOWS) return { file: process.execPath, script: "scripts/restore.mjs" };
  const script =
    type === "FILES"
      ? "scripts/restore-files.sh"
      : type === "FULL"
        ? "scripts/restore-full.sh"
        : "scripts/restore-db.sh";
  return { file: "bash", script };
}
