/**
 * Rate limit storage abstraction layer.
 * Defaults to in-memory Map storage (single instance).
 * Automatically switches to Redis when REDIS_URL is configured (multi-instance).
 */
import { config } from "@/lib/config/env";
import { createLogger } from "@/lib/logging";

const logger = createLogger("rate-limit-store");

export interface RateLimitStore {
	/** Add a timestamp for the given key. Returns all timestamps in window. */
	addAndGetWindow(_key: string, _timestamp: number, _windowMs: number): Promise<number[]>;
	/** Increment a counter for key-based rate limiting. */
	increment(_key: string, _windowMs: number): Promise<{ count: number; ttl: number }>;
	/** Get the current count for a key */
	get(_key: string): Promise<number | null>;
	/** Set a value with optional TTL */
	set(_key: string, _value: number, _ttlMs?: number): Promise<void>;
	/** Delete a key */
	delete(_key: string): Promise<void>;
}

// ── In-memory implementation ────────────────────────────────────
class MemoryRateLimitStore implements RateLimitStore {
	private store = new Map<string, { value: number; expiresAt: number | null }>();
	private timestamps = new Map<string, number[]>();

	constructor() {
		// Periodic cleanup
		setInterval(() => this.cleanup(), 5 * 60 * 1000);
	}

	async addAndGetWindow(key: string, timestamp: number, windowMs: number): Promise<number[]> {
		let entries = this.timestamps.get(key) ?? [];
		const cutoff = timestamp - windowMs;
		entries = entries.filter((t) => t > cutoff);
		entries.push(timestamp);
		this.timestamps.set(key, entries);
		return entries;
	}

	async increment(key: string, windowMs: number): Promise<{ count: number; ttl: number }> {
		const now = Date.now();
		const entry = this.store.get(key);
		if (!entry || (entry.expiresAt !== null && entry.expiresAt < now)) {
			const newEntry: { value: number; expiresAt: number } = { value: 1, expiresAt: now + windowMs };
			this.store.set(key, newEntry);
			return { count: 1, ttl: windowMs };
		}
		entry.value++;
		const ttl = entry.expiresAt !== null ? entry.expiresAt - now : windowMs;
		return { count: entry.value, ttl };
	}

	async get(key: string): Promise<number | null> {
		const entry = this.store.get(key);
		if (!entry) return null;
		if (entry.expiresAt && entry.expiresAt < Date.now()) {
			this.store.delete(key);
			return null;
		}
		return entry.value;
	}

	async set(key: string, value: number, ttlMs?: number): Promise<void> {
		this.store.set(key, {
			value,
			expiresAt: ttlMs ? Date.now() + ttlMs : null,
		});
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
		this.timestamps.delete(key);
	}

	private cleanup() {
		const now = Date.now();
		const storeKeys = Array.from(this.store.keys());
		for (const key of storeKeys) {
			const entry = this.store.get(key);
			if (entry?.expiresAt && entry.expiresAt < now) {
				this.store.delete(key);
			}
		}
		const tsKeys = Array.from(this.timestamps.keys());
		for (const key of tsKeys) {
			const timestamps = this.timestamps.get(key);
			if (!timestamps) continue;
			const recent = timestamps.filter((t) => now - t < 60 * 1000);
			if (recent.length === 0) {
				this.timestamps.delete(key);
			} else {
				this.timestamps.set(key, recent);
			}
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
	connect(): Promise<void>;
	multi(): {
		zAdd(key: string, entry: { score: number; value: string }): unknown;
		zRemRangeByScore(key: string, min: number, max: number): unknown;
		zRange(key: string, start: number, stop: number): unknown;
		pExpire(key: string, ms: number): unknown;
		incr(key: string): unknown;
		execAsPipeline(): Promise<RedisExecResult>;
	};
	get(key: string): Promise<string | null>;
	set(key: string, value: string, opts?: { PX?: number }): Promise<unknown>;
	del(keys: string[]): Promise<unknown>;
}
class RedisRateLimitStore implements RateLimitStore {
	private prefix = "rl:";
	private _client: RedisClientLike | null = null;

	constructor(private _url: string) {}

	private async getClient(): Promise<RedisClientLike> {
		if (this._client && this._client.isOpen) return this._client;
		// Dynamic require — redis is an optional peer dependency
		let redisModule;
		try {
			redisModule = await import("redis");
		} catch {
			throw new Error("redis package is not installed. Run: npm install redis");
		}
		this._client = (redisModule as unknown as { createClient: (opts: { url: string }) => RedisClientLike }).createClient({ url: this._url }) as RedisClientLike;
		await this._client.connect();
		return this._client;
	}

	async addAndGetWindow(key: string, timestamp: number, windowMs: number): Promise<number[]> {
		const client = await this.getClient();
		const k = `${this.prefix}ts:${key}`;
		const pipeline = client.multi();
		pipeline.zAdd(k, { score: timestamp, value: String(timestamp) });
		pipeline.zRemRangeByScore(k, 0, timestamp - windowMs);
		pipeline.zRange(k, 0, -1);
		pipeline.pExpire(k, windowMs);
		const results = await pipeline.execAsPipeline();
		const members: string[] = Array.isArray(results[2]) ? (results[2] as string[]) : [];
		return members.map(Number);
	}

	async increment(key: string, windowMs: number): Promise<{ count: number; ttl: number }> {
		const client = await this.getClient();
		const k = `${this.prefix}cnt:${key}`;
		const pipeline = client.multi();
		pipeline.incr(k);
		pipeline.pExpire(k, windowMs);
		const results = await pipeline.execAsPipeline();
		const count = Number(results[0]);
		const ttl = Number(results[1]) > 0 ? Number(results[1]) : windowMs;
		return { count, ttl };
	}

	async get(key: string): Promise<number | null> {
		const client = await this.getClient();
		const val = await client.get(`${this.prefix}cnt:${key}`);
		return val ? Number(val) : null;
	}

	async set(key: string, value: number, ttlMs?: number): Promise<void> {
		const client = await this.getClient();
		const k = `${this.prefix}cnt:${key}`;
		if (ttlMs) {
			await client.set(k, String(value), { PX: ttlMs });
		} else {
			await client.set(k, String(value));
		}
	}

	async delete(key: string): Promise<void> {
		const client = await this.getClient();
		await client.del([`${this.prefix}ts:${key}`, `${this.prefix}cnt:${key}`]);
	}
}

// ── Factory ─────────────────────────────────────────────────────
let _instance: RateLimitStore | null = null;

export function getRateLimitStore(): RateLimitStore {
	if (_instance) return _instance;

	const redisUrl = config.redis.url;
	if (redisUrl) {
		logger.info("Using Redis backend", { url: redisUrl.replace(/\/\/.*@/, "//***@") });
		_instance = new RedisRateLimitStore(redisUrl);
	} else {
		logger.info("Using in-memory backend (single-instance mode)");
		_instance = new MemoryRateLimitStore();
	}

	return _instance;
}
