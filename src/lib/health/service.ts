/**
 * Health service — barrel module (R28 god-file split).
 *
 * The previous 372-line god-file has been split into:
 *   - `./service-types`   — types, thresholds, silence-window + classify helpers
 *   - `./service-collect` — parallel SSH-metric collection + `HealthOverview` aggregation
 *   - `./service-metrics` — `metricSnapshot` CRUD (snapshot / history read)
 *   - `./service-alerts`  — `evaluateAlerts` rule matching + notification dispatch
 *   - `./alert-worker`    — durable-job wrapper around `evaluateAlerts` (R20 extraction)
 *
 * The 2 existing `@/lib/health/service` callers (api/health/route.ts +
 * api/alert-rules/route.ts) need no migration.
 */
export * from "./service-types";
export * from "./service-collect";
export * from "./service-metrics";
export * from "./service-alerts";
export * from "./capacity-predict";
export * from "./capacity-service";
