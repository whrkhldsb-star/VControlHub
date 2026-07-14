import { teamWhere } from "@/lib/auth/team-scope";
/**
 * Command service barrel.
 *
 * The 880-line god-file that lived here was decomposed into three cohesive
 * sub-modules in R20. The public API surface (functions + types) is preserved
 * verbatim through re-exports so call-sites in src/app/api/commands/** and
 * src/app/{commands,tasks} keep working.
 *
 *   service-execution.ts   SSH execution + heartbeat + enqueue (~430 lines)
 *   service-recovery.ts    stale-running + queued-approved recovery (~150)
 *   service-requests.ts    create/review/cancel/list command-requests (~440)
 *   execution-worker.ts    durable job worker (TR-001 T11) — enqueue + claim
 *   service.ts             barrel re-export (this file, ~30 lines)
 */

export {
  recoverStaleRunningCommandRequests,
  recoverQueuedApprovedCommandRequests,
} from "./service-recovery";

export {
  cancelCommandRequest,
  createCommandRequest,
  listCommandRequests,
  reviewCommandRequest,
} from "./service-requests";

// Re-export the worker-id constant so maintenance scripts (worker.ts,
// monitor scripts) can still import it from the service barrel.
export { COMMAND_WORKER_ID } from "./service-execution";

// TR-001 (T11): re-export the durable-job types/parsers so callers
// (e.g. operation-tasks API, deployment status sync) can introspect jobs
// that came from the command execution path.
export {
  COMMAND_EXECUTION_JOB_TYPE,
  parseCommandExecutionJobPayload,
} from "./execution-worker";
