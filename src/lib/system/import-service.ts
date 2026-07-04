/**
 * Import service — barrel module (TR-042 god-file split).
 *
 * The previous 1,618-line god-file has been split into:
 *   - `./import-preview`   — 17 per-table preview helpers + previewImport orchestrator
 *   - `./import-executors` — shared types/utils + 17 per-table import helpers + executeImport orchestrator
 *
 * The existing `@/lib/system/import-service` caller (api/system/import/route.ts)
 * needs no migration — only `previewImport` and `executeImport` are part of the
 * public API surface and both are re-exported below.
 */
export * from "./import-preview";
export * from "./import-executors";
