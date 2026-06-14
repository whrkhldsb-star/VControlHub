/**
 * Sync service — barrel module (R28 god-file split).
 *
 * The previous 435-line god-file has been split into:
 *   - `./service-commands`    — pure rsync / tar command builders + shellQuote re-export
 *   - `./service-credentials` — password / private-key decryptor
 *   - `./service-crud`        — prisma CRUD for `syncJob` + `SyncJobInput` type
 *   - `./service-runtime`     — `executeSyncJob` orchestration (rsync + tar fallback)
 *
 * The single existing caller (`./service.test.ts`) imports from
 * `@/lib/sync/service` and is unaffected by the re-exports below.
 */
export * from "./service-commands";
export * from "./service-credentials";
export * from "./service-crud";
export * from "./service-runtime";
