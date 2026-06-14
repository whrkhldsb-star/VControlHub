/**
 * Runtime-settings DTO boundary (TR-039).
 *
 * The `service.ts` module owns the canonical
 * `RUNTIME_SETTING_DEFINITIONS` table — it knows about the database,
 * the env-var fallback resolver and the validation rules. The
 * client-side `settings/settings-client.tsx` only needs the wire shape
 * of a single setting summary; it does not need the typed key union or
 * the resolver source enum at the type level.
 *
 * Exposing a minimal `RuntimeSettingSummaryDto` here lets the client
 * import a *type-only* file that stays free of Prisma / DB / server
 * imports. `service.ts` re-exports the type under its long-standing
 * name (`RuntimeSettingSummary`) so existing call sites keep working.
 */

/**
 * The string literal union for runtime setting keys lives in `service.ts`
 * because it derives from `keyof typeof RUNTIME_SETTING_DEFINITIONS`.
 * On the wire the key is just a string — the client treats it as opaque
 * and renders whatever the server sent.
 */
export type RuntimeSettingKeyDto = string;

export type RuntimeSettingSourceDto =
  | "database"
  | "environment"
  | "default"
  | "invalid-database";

export type RuntimeSettingSummaryDto = {
  key: RuntimeSettingKeyDto;
  label: string;
  unit: string;
  env: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  source: RuntimeSettingSourceDto;
  sourceLabel: string;
  applies: string;
  requiresRestart: boolean;
};
