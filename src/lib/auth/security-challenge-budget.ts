import { createHash } from "node:crypto";
import { RateLimitError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { getRateLimitStore } from "@/lib/rate-limit-store";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Setup, disable and recovery-code replacement share one failure window per account. */
export async function checkSecurityChallenge<T>(
  userId: string,
  verify: () => Promise<T>,
  accepted: (result: T) => boolean,
): Promise<T> {
  const key = "security-settings:" + createHash("sha256").update(userId).digest("hex");
  const store = getRateLimitStore();
  const blocked = () => new RateLimitError(t("apiCopy.request.tooManyRequests"));
  if (((await store.getLockout(key))?.lockedUntil ?? 0) > Date.now()) throw blocked();

  const result = await verify();
  if (accepted(result)) return result;

  // Each failed proof adds a distinct member to the shared window. Concurrent
  // failures never overwrite each other's increments. A separate expiring
  // marker lets subsequent requests stop before invoking the verifier.
  const now = Date.now();
  const failures = await store.addAndGetWindow(key, now, WINDOW_MS, MAX_FAILURES);
  if (failures.length >= MAX_FAILURES) {
    await store.setLockout(key, { failCount: failures.length, lastFailureAt: now, lockedUntil: now + WINDOW_MS }, WINDOW_MS);
    throw blocked();
  }
  return result;
}
