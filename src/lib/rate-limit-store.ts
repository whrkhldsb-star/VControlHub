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
}

// ── In-memory implementation ────────────────────────────────────
class MemoryRateLimitStore implements RateLimitStore {
	private timestamps = new Map<string, { entries: number[]; windowMs: number }>();

	constructor() {
		// Periodic cleanup
		setInterval(() => this.cleanup(), 5 * 60 * 1000);
	}

	async addAndGetWindow(key: string, timestamp: number, windowMs: number): Promise<number[]> {
		let entries = this.timestamps.get(key)?.entries ?? [];
		const cutoff = timestamp - windowMs;
		entries = entries.filter((t) => t > cutoff);
		entries.push(timestamp);
		this.timestamps.set(key, { entries, windowMs });
		return entries;
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
		execAsPipeline(): Promise<RedisExecResult>;
	};
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
