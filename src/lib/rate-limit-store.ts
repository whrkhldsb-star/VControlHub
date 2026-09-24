/**
 * Rate limit storage abstraction layer.
 * Defaults to in-memory Map storage (single instance).
 * Automatically switches to Redis when REDIS_URL is configured (multi-instance).
 */
import { config } from "@/lib/config/env";
import { createLogger } from "@/lib/logging";

const logger = createLogger("rate-limit-store");

export type AccountLockoutState = {
  failCount: number;
  lockedUntil: number | null;
  lastFailureAt: number;
};

export interface RateLimitStore {
  /** Add a timestamp for the given key. Returns all timestamps in window. */
  addAndGetWindow(
    _key: string,
    _timestamp: number,
    _windowMs: number,
  ): Promise<number[]>;
  /** Shared account-lockout state (multi-instance when Redis is configured). */
  getLockout(_key: string): Promise<AccountLockoutState | null>;
  setLockout(
    _key: string,
    _state: AccountLockoutState,
    _ttlMs: number,
  ): Promise<void>;
  deleteLockout(_key: string): Promise<void>;
}

// ── In-memory implementation ────────────────────────────────────
class MemoryRateLimitStore implements RateLimitStore {
  private timestamps = new Map<
    string,
    { entries: number[]; windowMs: number }
  >();
  private lockouts = new Map<
    string,
    { state: AccountLockoutState; expiresAt: number }
  >();

  constructor() {
    // Periodic cleanup — unref'd so the timer never keeps a process (tests,
    // one-shot CLI scripts) alive solely for rate-limit housekeeping.
    const timer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    timer.unref?.();
  }

  async addAndGetWindow(
    key: string,
    timestamp: number,
    windowMs: number,
  ): Promise<number[]> {
    let entries = this.timestamps.get(key)?.entries ?? [];
    const cutoff = timestamp - windowMs;
    entries = entries.filter((t) => t > cutoff);
    entries.push(timestamp);
    this.timestamps.set(key, { entries, windowMs });
    return entries;
  }

  async getLockout(key: string): Promise<AccountLockoutState | null> {
    const row = this.lockouts.get(key);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      this.lockouts.delete(key);
      return null;
    }
    return { ...row.state };
  }

  async setLockout(
    key: string,
    state: AccountLockoutState,
    ttlMs: number,
  ): Promise<void> {
    this.lockouts.set(key, {
      state: { ...state },
      expiresAt: Date.now() + Math.max(1, ttlMs),
    });
  }

  async deleteLockout(key: string): Promise<void> {
    this.lockouts.delete(key);
  }

  private cleanup() {
    const now = Date.now();
    const tsKeys = Array.from(this.timestamps.keys());
    for (const key of tsKeys) {
      const state = this.timestamps.get(key);
      if (!state) continue;
      const recent = state.entries.filter((t) => now - t < state.windowMs);
      if (recent.length === 0) {
        this.timestamps.delete(key);
      } else {
        this.timestamps.set(key, { ...state, entries: recent });
      }
    }
    for (const [key, row] of this.lockouts) {
      if (row.expiresAt <= now) this.lockouts.delete(key);
    }
  }
}

// ── Redis implementation ────────────────────────────────────────
// Redis client is loaded dynamically at runtime only when REDIS_URL is set.
// We type the client as a minimal structural interface (rather than the full
// `redis` package types) so this module remains compatible with redis being
// an optional peer dep — it can be absent at build time.
interface RedisExecResult {
  // `multi().execAsPipeline()` returns an array; element type is loose
  // because ZRANGE yields string[] while INCR yields number.
  [index: number]: unknown;
  length: number;
}
interface RedisClientLike {
  readonly isOpen: boolean;
  /** node-redis emits 'error' on connection loss/retry; attaching a listener
   * keeps those events from becoming uncaughtExceptions. */
  on(event: "error", listener: (error: unknown) => void): unknown;
  connect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { PX?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  multi(): {
    zAdd(key: string, entry: { score: number; value: string }): unknown;
    zRemRangeByScore(key: string, min: number, max: number): unknown;
    zRange(key: string, start: number, stop: number): unknown;
    pExpire(key: string, ms: number): unknown;
    execAsPipeline(): Promise<RedisExecResult>;
  };
}
class RedisRateLimitStore implements RateLimitStore {
  private prefix = "rl:";
  private _client: RedisClientLike | null = null;
  private _connecting: Promise<RedisClientLike> | null = null;

  constructor(private _url: string) {}

  private async getClient(): Promise<RedisClientLike> {
    if (this._client && this._client.isOpen) return this._client;
    // Share one in-flight connect: without this, concurrent first calls
    // (e.g. a burst of login attempts) would each construct and connect
    // their own client, leaking the losing sockets.
    if (!this._connecting) {
      this._connecting = this.connect().finally(() => {
        this._connecting = null;
      });
    }
    return this._connecting;
  }

  private async connect(): Promise<RedisClientLike> {
    // Dynamic require — redis is an optional peer dependency
    let redisModule;
    try {
      redisModule = await import("redis");
    } catch {
      throw new Error("redis package is not installed. Run: npm install redis");
    }
    const client = (
      redisModule as unknown as {
        createClient: (opts: { url: string }) => RedisClientLike;
      }
    ).createClient({ url: this._url }) as RedisClientLike;
    // An EventEmitter 'error' with no listener throws. A Redis outage must
    // degrade rate limiting, not crash the web/worker process.
    client.on("error", (error: unknown) => {
      logger.warn("Redis rate-limit client error", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    try {
      await client.connect();
    } catch (error) {
      // A half-initialized client must not be remembered: every later call
      // would see isOpen === false and construct yet another client, leaking
      // sockets for the duration of a Redis outage.
      this._client = null;
      throw error;
    }
    this._client = client;
    return this._client;
  }

  async addAndGetWindow(
    key: string,
    timestamp: number,
    windowMs: number,
  ): Promise<number[]> {
    const client = await this.getClient();
    const k = `${this.prefix}ts:${key}`;
    const pipeline = client.multi();
    pipeline.zAdd(k, {
      score: timestamp,
      value: `${timestamp}:${crypto.randomUUID()}`,
    });
    pipeline.zRemRangeByScore(k, 0, timestamp - windowMs);
    pipeline.zRange(k, 0, -1);
    pipeline.pExpire(k, windowMs);
    const results = await pipeline.execAsPipeline();
    const members: string[] = Array.isArray(results[2])
      ? (results[2] as string[])
      : [];
    return members
      .map((member) => Number(member.split(":", 1)[0]))
      .filter(Number.isFinite);
  }

  async getLockout(key: string): Promise<AccountLockoutState | null> {
    const client = await this.getClient();
    const raw = await client.get(`${this.prefix}lockout:${key}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as AccountLockoutState;
      if (
        typeof parsed.failCount !== "number" ||
        typeof parsed.lastFailureAt !== "number" ||
        !(parsed.lockedUntil === null || typeof parsed.lockedUntil === "number")
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async setLockout(
    key: string,
    state: AccountLockoutState,
    ttlMs: number,
  ): Promise<void> {
    const client = await this.getClient();
    await client.set(`${this.prefix}lockout:${key}`, JSON.stringify(state), {
      PX: Math.max(1, ttlMs),
    });
  }

  async deleteLockout(key: string): Promise<void> {
    const client = await this.getClient();
    await client.del(`${this.prefix}lockout:${key}`);
  }
}

// ── Factory ─────────────────────────────────────────────────────
let _instance: RateLimitStore | null = null;

export function getRateLimitStore(): RateLimitStore {
  if (_instance) return _instance;

  const redisUrl = config.redis.url;
  if (redisUrl) {
    logger.info("Using Redis backend", {
      url: redisUrl.replace(/\/\/.*@/, "//***@"),
    });
    _instance = new RedisRateLimitStore(redisUrl);
  } else {
    logger.info("Using in-memory backend (single-instance mode)");
    _instance = new MemoryRateLimitStore();
  }

  return _instance;
}
