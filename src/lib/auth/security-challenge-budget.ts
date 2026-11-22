import { createHash, randomUUID } from "node:crypto";
import { RateLimitError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { createLogger } from "@/lib/logging";
import { getRateLimitStore } from "@/lib/rate-limit-store";

const logger = createLogger("auth:security-challenge");
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
  const ticket = randomUUID();
  if (!await store.reserveChallenge(key, ticket, WINDOW_MS, MAX_FAILURES)) throw blocked();

  const release = async () => {
    try {
      await store.settleChallenge(key, ticket, false, WINDOW_MS, MAX_FAILURES);
    } catch (error) {
      // The reservation expires on its own. The verifier may already have committed a change.
      logger.warn("security challenge reservation release failed", error);
    }
  };
  let result: T;
  try {
    result = await verify();
    if (accepted(result)) {
      await release();
      return result;
    }
  } catch (error) {
    await release();
    throw error;
  }
  if (await store.settleChallenge(key, ticket, true, WINDOW_MS, MAX_FAILURES)) throw blocked();
  return result;
}
