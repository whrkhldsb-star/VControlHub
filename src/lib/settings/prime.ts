import { createLogger } from "@/lib/logging";
import { primeRuntimeSettingCache } from "@/lib/runtime-settings/cached";
import { primeCachedFlags } from "./cached-flags";

const logger = createLogger("settings-prime");

/**
 * Fill the per-process caches of settings read by synchronous callers (SSH
 * host-key pin policy, upload limits, queue sizes …) before the process does
 * real work. Without it the first calls after a start used the env/default
 * fallback until a background read finished. Never throws: without a
 * database the fallbacks apply, as before.
 */
export async function primeSettingCaches(): Promise<void> {
  try {
    await Promise.all([primeCachedFlags(), primeRuntimeSettingCache()]);
  } catch (error) {
    logger.warn("setting caches could not be primed; env/default fallbacks apply until the next read", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
