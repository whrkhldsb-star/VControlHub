/**
 * Rate limit storage abstraction layer.
 * Defaults to in-memory Map storage (single instance).
 * Automatically switches to Redis when REDIS_URL is configured (multi-instance).
 */
import { createHash } from "node:crypto";

import { config } from "@/lib/config/env";
import { createLogger } from "@/lib/logging";

const logger = createLogger("rate-limit-store");

export type AccountLockoutState = {
  failCount: number;
  lockedUntil: number | null;
  lastFailureAt: number;
};

type FailureCounter = { key: string; maxFailures: number };

export interface RateLimitStore {
  /**
   * Add a timestamp for the given key. Returns the timestamps in the window,
   * oldest first. With `keepNewest`, only that many of the newest are kept
   * and returned: a limiter of N needs N + 1 of them to decide and to compute
   * the retry delay, however many requests arrived. Without it every attempt
   * of the window stayed in the bucket, rejected ones included, so each check
   * of a client that kept sending cost as much as it had already sent (in
   * Redis the whole window came back over the wire on every request).
   */
  addAndGetWindow(
    _key: string,
    _timestamp: number,
    _windowMs: number,
    _keepNewest?: number,
  ): Promise<number[]>;
  /** Reserve capacity before verifying. A crashed verifier's reservation expires. */
  reserveChallenge(key: string, ticket: string, windowMs: number, limit: number): Promise<boolean>;
  /** Release this ticket or charge a failure. Returns true when the failure locks the account. */
  settleChallenge(key: string, ticket: string, failed: boolean, windowMs: number, limit: number): Promise<boolean>;
  /** Shared account-lockout state (multi-instance when Redis is configured). */
  getLockout(_key: string): Promise<AccountLockoutState | null>;
  setLockout(
    _key: string,
    _state: AccountLockoutState,
    _ttlMs: number,
  ): Promise<void>;
  /** Charge one failure to every supplied counter atomically. Results follow the input order. */
  recordFailures(_counters: FailureCounter[], _lockoutMs: number, _retentionMs: number): Promise<AccountLockoutState[]>;
  deleteLockouts(_keys: string[]): Promise<void>;
}

// ── In-memory implementation ────────────────────────────────────
// Keys embed request-controlled text (user names, paths): bound each key and the number of keys
// so unauthenticated traffic cannot grow the maps without limit between cleanup passes.
const MEMORY_STORE_MAX_KEY_CHARS = 256;
const MEMORY_STORE_MAX_KEYS = 50_000;
/** A full namespace drops expired buckets before evicting a live one, at most this often. */
const MEMORY_STORE_SWEEP_INTERVAL_MS = 1_000;

function boundedKey(key: string): string {
  if (key.length <= MEMORY_STORE_MAX_KEY_CHARS) return key;
  return `${key.slice(0, 128)}#${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

/**
 * The namespace a bucket is capped in. Path-derived buckets from `withRateLimit` ("/api/…:ip") share
 * one namespace; every other identifier is "<prefix>:…" with a prefix fixed in code (login, share-password, …).
 *
 * One shared cap let anonymous requests to made-up paths push the login and share-password counters out
 * (the oldest key went first, live or not), handing an attacker fresh guesses after every flood. With a
 * cap per namespace a flood can only evict buckets of its own kind.
 */
export function rateLimitNamespace(key: string): string {
  if (key.startsWith("/")) return "path";
  const colon = key.indexOf(":");
  return colon > 0 ? key.slice(0, Math.min(colon, 64)) : "other";
}

type WindowBucket = { entries: number[]; windowMs: number };

class MemoryRateLimitStore implements RateLimitStore {
  private timestamps = new Map<string, Map<string, WindowBucket>>();
  private lastSweepAt = new Map<string, number>();
  private lockouts = new Map<
    string,
    { state: AccountLockoutState; expiresAt: number }
  >();
  private lastLockoutSweepAt = 0;
  private challenges = new Map<string, Map<string, number>>();

  constructor() {
    // Periodic cleanup — unref'd so the timer never keeps a process (tests,
    // one-shot CLI scripts) alive solely for rate-limit housekeeping.
    const timer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    timer.unref?.();
  }

  private namespaceMap(key: string): { name: string; map: Map<string, WindowBucket> } {
    const name = rateLimitNamespace(key);
    let map = this.timestamps.get(name);
    if (!map) {
      map = new Map();
      this.timestamps.set(name, map);
    }
    return { name, map };
  }

  /** Make room for `incomingKey`: expired buckets go first, a live one only when none has expired. */
  private makeRoom(name: string, map: Map<string, WindowBucket>, incomingKey: string, now: number) {
    if (map.has(incomingKey) || map.size < MEMORY_STORE_MAX_KEYS) return;
    if (now - (this.lastSweepAt.get(name) ?? 0) >= MEMORY_STORE_SWEEP_INTERVAL_MS) {
      this.lastSweepAt.set(name, now);
      for (const [key, bucket] of map) {
        if (!bucket.entries.some((t) => now - t < bucket.windowMs)) map.delete(key);
      }
      if (map.size < MEMORY_STORE_MAX_KEYS) return;
    }
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }

  async addAndGetWindow(
    key: string,
    timestamp: number,
    windowMs: number,
    keepNewest?: number,
  ): Promise<number[]> {
    key = boundedKey(key);
    const { name, map } = this.namespaceMap(key);
    let entries = map.get(key)?.entries ?? [];
    const cutoff = timestamp - windowMs;
    entries = entries.filter((t) => t > cutoff);
    entries.push(timestamp);
    if (keepNewest !== undefined && keepNewest >= 1 && entries.length > keepNewest) {
      entries = entries.slice(-keepNewest);
    }
    this.makeRoom(name, map, key, timestamp);
    map.set(key, { entries, windowMs });
    return entries;
  }

  private liveTickets(key: string, now: number) {
    const tickets = this.challenges.get(key);
    if (tickets) {
      for (const [id, deadline] of tickets) if (deadline <= now) tickets.delete(id);
      if (!tickets.size) this.challenges.delete(key);
    }
    return tickets;
  }

  async reserveChallenge(key: string, ticket: string, windowMs: number, limit: number) {
    const bounded = boundedKey(key);
    const now = Date.now();
    if (this.readLockout(bounded, now)?.lockedUntil) return false;
    const tickets = this.liveTickets(bounded, now) ?? new Map<string, number>();
    if (tickets.size >= limit || (!tickets.size && this.challenges.size >= MEMORY_STORE_MAX_KEYS)) return false;
    tickets.set(ticket, now + windowMs);
    this.challenges.set(bounded, tickets);
    return true;
  }

  async settleChallenge(key: string, ticket: string, failed: boolean, windowMs: number, limit: number) {
    const bounded = boundedKey(key);
    const now = Date.now();
    const tickets = this.liveTickets(bounded, now);
    if (!tickets?.delete(ticket)) return false;
    if (failed) tickets.set("failed:" + ticket, now + windowMs);
    if (!tickets.size) this.challenges.delete(bounded);
    const failures = [...tickets.keys()].filter(id => id.startsWith("failed:")).length;
    if (failures < limit) return false;
    this.writeLockout(bounded, { failCount: failures, lastFailureAt: now, lockedUntil: now + windowMs }, now + windowMs, now);
    return true;
  }

  private readLockout(key: string, now: number): AccountLockoutState | null {
    const row = this.lockouts.get(key);
    if (!row) return null;
    if (row.expiresAt <= now || (row.state.lockedUntil !== null && row.state.lockedUntil <= now)) {
      this.lockouts.delete(key);
      return null;
    }
    return row.state;
  }

  private writeLockout(key: string, state: AccountLockoutState, expiresAt: number, now: number) {
    if (!this.lockouts.has(key) && this.lockouts.size >= MEMORY_STORE_MAX_KEYS) {
      // Expired lockouts make room first, so a burst of failures cannot push out a live lock.
      if (now - this.lastLockoutSweepAt >= MEMORY_STORE_SWEEP_INTERVAL_MS) {
        this.lastLockoutSweepAt = now;
        for (const [existing, row] of this.lockouts) {
          if (row.expiresAt <= now) this.lockouts.delete(existing);
        }
      }
      if (this.lockouts.size >= MEMORY_STORE_MAX_KEYS) {
        const oldest = this.lockouts.keys().next().value;
        if (oldest !== undefined) this.lockouts.delete(oldest);
      }
    }
    this.lockouts.set(key, { state: { ...state }, expiresAt });
  }

  async getLockout(key: string): Promise<AccountLockoutState | null> {
    const state = this.readLockout(boundedKey(key), Date.now());
    return state && { ...state };
  }

  async setLockout(key: string, state: AccountLockoutState, ttlMs: number): Promise<void> {
    const now = Date.now();
    this.writeLockout(boundedKey(key), state, now + Math.max(1, ttlMs), now);
  }

  async recordFailures(counters: FailureCounter[], lockoutMs: number, retentionMs: number) {
    const now = Date.now();
    return counters.map(({ key, maxFailures }) => {
      const bounded = boundedKey(key);
      const previous = this.readLockout(bounded, now);
      const failCount = previous && (previous.lockedUntil !== null || now - previous.lastFailureAt < retentionMs)
        ? previous.failCount + 1 : 1;
      const lockedUntil = previous?.lockedUntil ?? (failCount >= maxFailures ? now + lockoutMs : null);
      const state = { failCount, lockedUntil, lastFailureAt: now };
      this.writeLockout(bounded, state, lockedUntil ?? now + retentionMs, now);
      return state;
    });
  }

  async deleteLockouts(keys: string[]): Promise<void> {
    for (const key of keys) {
      const bounded = boundedKey(key);
      this.lockouts.delete(bounded);
      this.challenges.delete(bounded);
    }
  }

  private cleanup() {
    const now = Date.now();
    for (const key of this.challenges.keys()) this.liveTickets(key, now);
    for (const [name, map] of this.timestamps) {
      for (const [key, state] of map) {
        const recent = state.entries.filter((t) => now - t < state.windowMs);
        if (recent.length === 0) {
          map.delete(key);
        } else {
          map.set(key, { ...state, entries: recent });
        }
      }
      if (map.size === 0) {
        this.timestamps.delete(name);
        this.lastSweepAt.delete(name);
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
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  set(key: string, value: string, options?: { PX?: number }): Promise<unknown>;
  del(keys: string[]): Promise<unknown>;
  multi(): {
    zAdd(key: string, entry: { score: number; value: string }): unknown;
    zRemRangeByScore(key: string, min: number, max: number): unknown;
    zRemRangeByRank(key: string, start: number, stop: number): unknown;
    zRange(key: string, start: number, stop: number): unknown;
    pExpire(key: string, ms: number): unknown;
    execAsPipeline(): Promise<RedisExecResult>;
  };
}

// Existing deployments store JSON with a short TTL grace period. Check the
// embedded deadline and delete it in the same Redis operation as the read.
const READ_LOCKOUT = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local function readLockout(key)
  local raw = redis.call('GET', key)
  if not raw then return nil end
  local ok, state = pcall(cjson.decode, raw)
  if not ok or type(state) ~= 'table' or type(state.failCount) ~= 'number'
    or type(state.lastFailureAt) ~= 'number'
    or (state.lockedUntil ~= cjson.null and type(state.lockedUntil) ~= 'number') then
    return nil
  end
  if state.lockedUntil ~= cjson.null and state.lockedUntil <= now then
    redis.call('DEL', key)
    return nil
  end
  return state, raw
end
`;

const GET_LOCKOUT = READ_LOCKOUT + `
local _, raw = readLockout(KEYS[1])
return raw or false
`;

// Each account has at most limit tickets. A failure replaces only its own
// reservation. A late settlement can never remove a newer verifier's ticket.
const CHALLENGE_WINDOW = READ_LOCKOUT + `
local window, limit, ticket = tonumber(ARGV[1]), tonumber(ARGV[2]), ARGV[3]
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if ARGV[4] == 'reserve' then
  if readLockout(KEYS[2]) or redis.call('ZCARD', KEYS[1]) >= limit then return 0 end
  redis.call('ZADD', KEYS[1], now + window, ticket)
  redis.call('PEXPIRE', KEYS[1], window)
  return 1
end
if redis.call('ZREM', KEYS[1], ticket) == 0 or ARGV[4] == 'release' then return 0 end
redis.call('ZADD', KEYS[1], now + window, 'failed:' .. ticket)
redis.call('PEXPIRE', KEYS[1], window)
local failures = 0
for _, id in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do
  if string.sub(id, 1, 7) == 'failed:' then failures = failures + 1 end
end
if failures < limit then return 0 end
local state = {failCount = failures, lastFailureAt = now, lockedUntil = now + window}
redis.call('SET', KEYS[2], cjson.encode(state), 'PX', window)
return 1
`;

const RECORD_FAILURES = READ_LOCKOUT + `
local lockoutMs, retentionMs = tonumber(ARGV[1]), tonumber(ARGV[2])
local result = {}
for i, key in ipairs(KEYS) do
  local state = readLockout(key)
  if not state or (state.lockedUntil == cjson.null and now - state.lastFailureAt >= retentionMs) then
    state = {failCount = 0, lockedUntil = cjson.null}
  end
  state.failCount = state.failCount + 1
  state.lastFailureAt = now
  if state.lockedUntil == cjson.null and state.failCount >= tonumber(ARGV[i + 2]) then
    state.lockedUntil = now + lockoutMs
  end
  local ttl = state.lockedUntil == cjson.null and retentionMs or state.lockedUntil - now
  result[i] = cjson.encode(state)
  redis.call('SET', key, result[i], 'PX', ttl)
end
return result
`;

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
    keepNewest?: number,
  ): Promise<number[]> {
    const client = await this.getClient();
    const k = `${this.prefix}ts:${key}`;
    const pipeline = client.multi();
    pipeline.zAdd(k, {
      score: timestamp,
      value: `${timestamp}:${crypto.randomUUID()}`,
    });
    pipeline.zRemRangeByScore(k, 0, timestamp - windowMs);
    let rangeIndex = 2;
    if (keepNewest !== undefined && keepNewest >= 1) {
      // Everything below the newest `keepNewest` members: nothing when there are no more than that.
      pipeline.zRemRangeByRank(k, 0, -(keepNewest + 1));
      rangeIndex = 3;
    }
    pipeline.zRange(k, 0, -1);
    pipeline.pExpire(k, windowMs);
    const results = await pipeline.execAsPipeline();
    const members: string[] = Array.isArray(results[rangeIndex])
      ? (results[rangeIndex] as string[])
      : [];
    return members
      .map((member) => Number(member.split(":", 1)[0]))
      .filter(Number.isFinite);
  }

  private async challengeTicket(key: string, ticket: string, windowMs: number, limit: number, operation: string) {
    const client = await this.getClient();
    return (await client.eval(CHALLENGE_WINDOW, {
      keys: [`${this.prefix}challenge:${key}`, `${this.prefix}lockout:${key}`],
      arguments: [String(windowMs), String(limit), ticket, operation],
    })) === 1;
  }

  reserveChallenge(key: string, ticket: string, windowMs: number, limit: number) {
    return this.challengeTicket(key, ticket, windowMs, limit, "reserve");
  }

  settleChallenge(key: string, ticket: string, failed: boolean, windowMs: number, limit: number) {
    return this.challengeTicket(key, ticket, windowMs, limit, failed ? "fail" : "release");
  }

  async getLockout(key: string): Promise<AccountLockoutState | null> {
    const client = await this.getClient();
    const raw = await client.eval(GET_LOCKOUT, { keys: [`${this.prefix}lockout:${key}`], arguments: [] });
    return typeof raw === "string" ? JSON.parse(raw) : null;
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

  async recordFailures(counters: FailureCounter[], lockoutMs: number, retentionMs: number): Promise<AccountLockoutState[]> {
    const client = await this.getClient();
    const rows = await client.eval(RECORD_FAILURES, {
      keys: counters.map(({ key }) => `${this.prefix}lockout:${key}`),
      arguments: [String(lockoutMs), String(retentionMs), ...counters.map(({ maxFailures }) => String(maxFailures))],
    }) as string[];
    return rows.map(row => JSON.parse(row));
  }

  async deleteLockouts(keys: string[]): Promise<void> {
    const client = await this.getClient();
    await client.del(keys.flatMap(key => [`${this.prefix}lockout:${key}`, `${this.prefix}challenge:${key}`]));
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
