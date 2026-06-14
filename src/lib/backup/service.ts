/**
 * Backup service — barrel module (R28 god-file split).
 *
 * The previous 382-line god-file has been split into:
 *   - `./service-types`    — types, constants, and pure path/type helpers
 *   - `./service-commands` — pure command builders (bash / tar strings)
 *   - `./service-policy`   — failure-classification + size-format + policy reducer
 *   - `./service-crud`     — prisma CRUD + lifecycle (void / retry)
 *   - `./service-runtime`  — execution orchestration (run / restore / aggregate)
 *   - `./command-runner`   — `bash`/`tar` child-process adapter (R13 extraction)
 *   - `./schema`           — zod DTO schemas (R15 extraction)
 *
 * The 6 existing `@/lib/backup/service` callers (api/backups/* + actions.ts
 * + job-worker.ts) need no migration.
 */
export * from "./service-types";
export * from "./service-commands";
export * from "./service-policy";
export * from "./service-crud";
export * from "./service-runtime";
