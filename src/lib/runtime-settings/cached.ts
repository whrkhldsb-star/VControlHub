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
// Bumped by every save (and a reset): a read started before it must not put
// the old value back. One that did undid the save in this process for a
// minute, and jobs queued meanwhile took the old attempt count.
const generations = new Map<RuntimeSettingKey, number>();
let epoch = 0;
const generationOf = (key: RuntimeSettingKey) => `${epoch}:${generations.get(key) ?? 0}`;

export function getRuntimeSettingNumberCached(key: RuntimeSettingKey): number {
  const hit = cache.get(key);
  if ((!hit || Date.now() - hit.loadedAt > TTL_MS) && !inflight.has(key)) {
    inflight.add(key);
    const started = generationOf(key);
    void readPersistedRuntimeSettingNumberStrict(key)
      .then((persisted) => {
        if (generationOf(key) === started) cache.set(key, { persisted, loadedAt: Date.now() });
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
  generations.set(key, (generations.get(key) ?? 0) + 1);
  cache.set(key, { persisted: value, loadedAt: Date.now() });
}

/** Load every runtime setting once (process start), so sync callers never begin on the fallback. */
export async function primeRuntimeSettingCache(): Promise<void> {
  const keys = Object.keys(RUNTIME_SETTING_DEFINITIONS) as RuntimeSettingKey[];
  const started = keys.map(generationOf);
  const values = await Promise.all(keys.map((key) => readPersistedRuntimeSettingNumberStrict(key)));
  const now = Date.now();
  keys.forEach((key, index) => {
    if (generationOf(key) === started[index]) cache.set(key, { persisted: values[index] ?? null, loadedAt: now });
  });
}

export function resetRuntimeSettingCache() {
  cache.clear();
  inflight.clear();
  generations.clear();
  epoch += 1;
}
