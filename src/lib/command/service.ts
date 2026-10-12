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
 *   execution-queue.ts     durable job payload validation + enqueue
 *   execution-worker.ts    durable job claim + execution loop (TR-001 T11)
 *   service.ts             barrel re-export (this file, ~30 lines)
 */

export {
  recoverStaleRunningCommandRequests,
  recoverQueuedApprovedCommandRequests,
} from "./service-recovery";

export { cancelCommandRequest, createCommandRequest, listCommandRequests, reviewCommandRequest } from "./service-requests";
