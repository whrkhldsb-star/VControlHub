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

/** The stored flag, null for "no row / empty" (env fallback); a database error is thrown. */
async function readPersistedFlag(key: string): Promise<boolean | null> {
  const delegate = (prisma as unknown as { setting?: { findUnique?: (args: { where: { key: string }; select: { value: true } }) => Promise<{ value: string | null } | null> } }).setting;
  if (!delegate?.findUnique) return null;
  const row = await delegate.findUnique({ where: { key }, select: { value: true } });
  const raw = row?.value?.trim().toLowerCase();
  return raw === "true" ? true : raw === "false" ? false : null;
}

/**
 * `unknown` answers until the stored value has been read successfully once:
 * a security flag must not fall back to its permissive env default just
 * because the process started while the database was unreachable.
 */
function getBooleanSettingCached(key: string, fallback: boolean, unknown: boolean): boolean {
  const hit = cache.get(key);
  if ((!hit || Date.now() - hit.loadedAt > TTL_MS) && !inflight.has(key)) {
    inflight.add(key);
    // Never let a missing or failing database reach the caller: tests mock
    // the db module without a `setting` delegate. A connection error keeps
    // the last known value (the next call retries) instead of reverting to
    // the env fallback.
    void readPersistedFlag(key)
      .then((persisted) => {
        cache.set(key, { persisted, loadedAt: Date.now() });
      })
      .catch(() => undefined)
      .finally(() => {
        inflight.delete(key);
      });
  }
  if (!hit) return unknown;
  return hit.persisted ?? fallback;
}

/**
 * `security.sshEnforceHostKeyPin`, else SSH_ENFORCE_HOST_KEY_PIN, else false.
 * Until the stored policy has been read (normally at process start, see
 * settings/prime) connections are held to the strict policy: unpinned hosts
 * are refused rather than trusted on first use.
 */
export function getSshEnforceHostKeyPin(): boolean {
  return getBooleanSettingCached("security.sshEnforceHostKeyPin", config.ssh.enforceHostKeyPin, true);
}

const FLAG_KEYS = ["security.sshEnforceHostKeyPin"] as const;

/** Load the flags once at process start, so the first connections already use the stored policy. */
export async function primeCachedFlags(): Promise<void> {
  const values = await Promise.all(FLAG_KEYS.map((key) => readPersistedFlag(key)));
  const now = Date.now();
  FLAG_KEYS.forEach((key, index) => cache.set(key, { persisted: values[index] ?? null, loadedAt: now }));
}

export function invalidateCachedFlags() {
  cache.clear();
}
