/**
 * Single-flight + short memoization for expensive, idempotent reads.
 *
 * Used where many concurrent callers would otherwise trigger the same costly
 * work: N browser tabs polling `/api/health` each used to open a full SSH
 * session per managed server. The first caller performs the work, the rest
 * await the same promise, and the result is reused for a short TTL so ordinary
 * polling does not re-run it at all.
 *
 * Failures are never memoized — the next caller retries immediately — and
 * results are keyed by the caller, so tenant-scoped values never leak across
 * keys.
 */
type MemoEntry<T> = { value: T; expiresAt: number };

export type SingleFlight<T> = {
  run: (key: string, fn: () => Promise<T>) => Promise<T>;
  /** Drop memoized results (tests, forced refresh). */
  reset: () => void;
};

export function createSingleFlight<T>(options: {
  /**
   * How long a successful result is reused. 0 disables memoization (dedupe
   * only). A function is re-evaluated on every `run`, so deployments and tests
   * can change the window at runtime.
   */
  ttlMs: number | (() => number);
  /** Bound the key space so caller-controlled keys cannot grow the maps. */
  maxKeys?: number;
}): SingleFlight<T> {
  const maxKeys = options.maxKeys ?? 64;
  const ttlMs = () => (typeof options.ttlMs === "function" ? options.ttlMs() : options.ttlMs);
  const inflight = new Map<string, Promise<T>>();
  const memo = new Map<string, MemoEntry<T>>();

  function evictIfNeeded(map: Map<string, unknown>) {
    while (map.size > maxKeys) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
  }

  return {
    async run(key, fn) {
      const now = Date.now();
      const cached = memo.get(key);
      if (cached) {
        if (cached.expiresAt > now) return cached.value;
        memo.delete(key);
      }

      const pending = inflight.get(key);
      if (pending) return pending;

      const promise = fn()
        .then((value) => {
          const ttl = ttlMs();
          if (ttl > 0) {
            memo.set(key, { value, expiresAt: Date.now() + ttl });
            evictIfNeeded(memo);
          }
          return value;
        })
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, promise);
      evictIfNeeded(inflight);
      return promise;
    },
    reset() {
      memo.clear();
    },
  };
}
