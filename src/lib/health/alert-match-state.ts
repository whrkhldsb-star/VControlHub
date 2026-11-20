import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";

const logger = createLogger("health:alert-match-state");

/** serverId → ISO match-start timestamp */
export type AlertMatchState = Record<string, string>;

export const LEGACY_MATCH_KEY = "_legacy";

export function parseAlertMatchState(raw: unknown): AlertMatchState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: AlertMatchState = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      const ms = Date.parse(value);
      if (Number.isFinite(ms)) out[key] = new Date(ms).toISOString();
    }
  }
  return out;
}

export function matchStartedAtForServer(
  state: AlertMatchState,
  serverId: string,
): Date | null {
  const iso = state[serverId] ?? state[LEGACY_MATCH_KEY];
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function deriveLegacyLastMatchedAt(state: AlertMatchState): Date | null {
  let latest: Date | null = null;
  for (const [key, iso] of Object.entries(state)) {
    if (key === LEGACY_MATCH_KEY) continue;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) continue;
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  return latest;
}

/**
 * Persist a rule's per-server match state with a compare-and-set on
 * `updatedAt`. Two concurrent evaluators (background worker + a manual
 * team-scoped "evaluate now", or two workers after a deploy) used to
 * unconditionally `update`, so the slower pass overwrote whatever the faster
 * pass had just written — resetting duration windows or resurrecting cleared
 * stamps. With the CAS the loser sees count===0, keeps its in-memory state for
 * the rest of its own pass (the in-pass judgment stays self-consistent), and
 * logs; the next evaluation re-reads whichever version committed last.
 */
export async function persistMatchState(
  rule: { id: string; updatedAt: Date },
  state: AlertMatchState,
  extra: { lastTriggeredAt?: Date } = {},
) {
  const cleaned: AlertMatchState = { ...state };
  delete cleaned[LEGACY_MATCH_KEY];
  const updated = await prisma.alertRule.updateMany({
    where: { id: rule.id, updatedAt: rule.updatedAt },
    data: {
      matchState: cleaned,
      lastMatchedAt: deriveLegacyLastMatchedAt(cleaned),
      ...extra,
    },
  });
  if (updated.count === 0) {
    logger.warn(
      "alert rule match-state persistence lost a concurrent write; keeping in-memory state for this pass",
      { ruleId: rule.id },
    );
  }
}
