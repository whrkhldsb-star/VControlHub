/**
 * Storage service barrel.
 *
 * The 1099-line god-file that lived here was decomposed into five cohesive
 * sub-modules in TR-038-foundation / R18. The public API surface
 * (functions + types) is preserved verbatim through re-exports so the eight
 * call-sites in src/app/** and src/lib/files/tree.ts keep working.
 *
 *   service-direct-access.ts   strategy / summary / row types
 *   service-nodes.ts           node CRUD + health + listing
 *   service-entries.ts         file-entry CRUD + soft-delete + restore + listing
 *   service-overview.ts        aggregated overview + directory summaries
 *   service-editable.ts        local-only online editor draft save / load
 */
export { buildDirectAccessStrategy } from "./service-direct-access";

export { checkStorageNodeHealth, createStorageNode, deleteStorageNode, listStorageNodes, updateStorageNode } from "./service-nodes";

export { createFileEntry, listDeletedFileEntries, listFileEntries, restoreFileEntry } from "./service-entries";

export { getStorageOverview } from "./service-overview";

export {
  getLocalEditableFileDraft,
  saveLocalEditableFileDraft,
} from "./service-editable";
