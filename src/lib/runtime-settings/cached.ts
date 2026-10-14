import {
  RUNTIME_SETTING_DEFINITIONS,
  getRuntimeSettingFallback,
  readPersistedRuntimeSettingNumberStrict,
  type RuntimeSettingKey,
} from "./service";

/**
 * Runtime settings for callers that cannot await (schema parsing, a sync
 * normaliser): the persisted value is read in the background and remembered
 * for a minute per process; until the first read lands, and whenever no row
 * exists, the env/default fallback is computed at call time. A save in this
 * process updates the entry immediately (see `rememberRuntimeSettingNumber`);
 * other processes pick it up within the minute. Processes prime the cache at
 * start (`primeRuntimeSettingCache`), and a failed read keeps the last known
 * value instead of falling back to env/default until the next refresh.
 */
const TTL_MS = 60_000;
const cache = new Map<RuntimeSettingKey, { persisted: number | null; loadedAt: number }>();
const inflight = new Set<RuntimeSettingKey>();

export function getRuntimeSettingNumberCached(key: RuntimeSettingKey): number {
  const hit = cache.get(key);
  if ((!hit || Date.now() - hit.loadedAt > TTL_MS) && !inflight.has(key)) {
    inflight.add(key);
    void readPersistedRuntimeSettingNumberStrict(key)
      .then((persisted) => {
        cache.set(key, { persisted, loadedAt: Date.now() });
      })
      // Keep the previous entry; the next call retries.
      .catch(() => undefined)
      .finally(() => {
        inflight.delete(key);
      });
  }
  return hit?.persisted ?? getRuntimeSettingFallback(key);
}

/** Called after a save so the saving process does not wait for the TTL. */
export function rememberRuntimeSettingNumber(key: RuntimeSettingKey, value: number | null) {
  cache.set(key, { persisted: value, loadedAt: Date.now() });
}

/** Load every runtime setting once (process start), so sync callers never begin on the fallback. */
export async function primeRuntimeSettingCache(): Promise<void> {
  const keys = Object.keys(RUNTIME_SETTING_DEFINITIONS) as RuntimeSettingKey[];
  const values = await Promise.all(keys.map((key) => readPersistedRuntimeSettingNumberStrict(key)));
  const now = Date.now();
  keys.forEach((key, index) => cache.set(key, { persisted: values[index] ?? null, loadedAt: now }));
}

export function resetRuntimeSettingCache() {
  cache.clear();
  inflight.clear();
}
