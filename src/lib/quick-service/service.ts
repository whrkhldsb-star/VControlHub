/**
 * Barrel module for the quick-service package.
 *
 * Public surface (re-exported from `./service-lifecycle` and
 * `./service-internals`):
 *   - lifecycle verbs: installService / uninstallService / startService /
 *     stopService / updateService / syncServiceStatus / checkPort
 *   - read-only helpers: listQuickServices / listQuickServiceHistory /
 *     getQuickService
 *   - port utilities: isPortAvailableSync / allocatePort / getUsedPorts
 *   - option types: InstallOptions / UninstallServiceOptions
 *   - re-exported ServiceTemplate type (kept here for back-compat with
 *     code that still imports it from `./service`)
 *
 * The split into `service-internals` (helpers / port allocation / safety
 * validators) and `service-lifecycle` (public verbs) keeps each file
 * under 500 lines and makes the helpers unit-testable in isolation.
 */
export * from "./service-internals";
export * from "./service-lifecycle";

// Back-compat: callers that import `ServiceTemplate` from `./service`
// keep working. (R28 barrel split — the type lives in `./types`.)
export type { ServiceTemplate } from "./types";
