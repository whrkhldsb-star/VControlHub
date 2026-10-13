import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";

/**
 * Boolean settings for synchronous callers. The persisted value ("true" /
 * "false") wins; an empty or missing row means the env/default fallback. Read
 * in the background and remembered for a minute per process; a save in this
 * process invalidates immediately (see settings/service rememberSaved).
 */
const TTL_MS = 60_000;
const cache = new Map<string, { persisted: boolean | null; loadedAt: number }>();
const inflight = new Set<string>();

async function readPersistedFlag(key: string): Promise<boolean | null> {
  try {
    const delegate = (prisma as unknown as { setting?: { findUnique?: (args: { where: { key: string }; select: { value: true } }) => Promise<{ value: string | null } | null> } }).setting;
    if (!delegate?.findUnique) return null;
    const row = await delegate.findUnique({ where: { key }, select: { value: true } });
    const raw = row?.value?.trim().toLowerCase();
    return raw === "true" ? true : raw === "false" ? false : null;
  } catch {
    return null;
  }
}

function getBooleanSettingCached(key: string, fallback: boolean): boolean {
  const hit = cache.get(key);
  if ((!hit || Date.now() - hit.loadedAt > TTL_MS) && !inflight.has(key)) {
    inflight.add(key);
    // Never let a missing or failing database reach the caller: tests mock
    // the db module without a `setting` delegate, and a connection error
    // must leave the env fallback in force.
    void readPersistedFlag(key)
      .then((persisted) => {
        cache.set(key, { persisted, loadedAt: Date.now() });
      })
      .catch(() => undefined)
      .finally(() => {
        inflight.delete(key);
      });
  }
  return hit?.persisted ?? fallback;
}

/** `security.sshEnforceHostKeyPin`, else SSH_ENFORCE_HOST_KEY_PIN, else false. */
export function getSshEnforceHostKeyPin(): boolean {
  return getBooleanSettingCached("security.sshEnforceHostKeyPin", config.ssh.enforceHostKeyPin);
}

export function invalidateCachedFlags() {
  cache.clear();
}
