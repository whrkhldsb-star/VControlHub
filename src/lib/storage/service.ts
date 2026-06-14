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
export {
  buildDirectAccessStrategy,
  buildStorageConnectionSummary,
  type DirectAccessMode,
  type DirectAccessResult,
  type StorageNodeListRow,
} from "./service-direct-access";

export {
  checkStorageNodeHealth,
  createStorageNode,
  deleteStorageNode,
  ensureDefaultNodeState,
  listStorageNodes,
  updateStorageNode,
  type StorageNodeHealthStatus,
} from "./service-nodes";

export {
  createFileEntry,
  formatFileSize,
  isEditableTextFile,
  listDeletedFileEntries,
  listFileEntries,
  resolveLocalAbsolutePath,
  restoreFileEntry,
  softDeleteFileEntry,
  updateFileEntry,
  type DeletedFileEntryRow,
  type DeletedFileEntryWithNode,
  type FileEntryListRow,
} from "./service-entries";

export {
  getStorageOverview,
  type DirectorySummary,
} from "./service-overview";

export {
  getLocalEditableFileDraft,
  saveLocalEditableFileDraft,
} from "./service-editable";
