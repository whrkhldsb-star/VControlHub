/**
 * Notification fan-out bus.
 *
 * The notification service calls the ws push helpers from whichever process
 * handles the triggering event (web instance or worker), but the recipient's
 * sockets live on one specific web instance. Single-instance deployments can
 * deliver in-process; with REDIS_URL configured every instance must see every
 * message, so publishes go to a Redis pub/sub channel and each instance's
 * subscriber fans out to its local connection registry.
 *
 * Mirrors rate-limit-store's dynamic `redis` import (optional dependency,
 * error listener attached so an outage never becomes an unhandled
 * 'error' event crash).
 *
 * Without Redis the deployment still runs the worker as a separate process
 * from the web server: in-process delivery dropped every notification the
 * worker created (alerts, backups, commands) while the page, connected to the
 * web server, had stopped polling. PostgreSQL's LISTEN/NOTIFY carries them
 * across processes there, with no extra service.
 */
import { config } from "@/lib/config/env";
import { createLogger } from "@/lib/logging";

const logger = createLogger("ws:notification-bus");

export const NOTIFICATION_BUS_CHANNEL = "vch:notifications";

/** Delivers a parsed message to this instance's local sockets. */
export type LocalDelivery = (userId: string, message: unknown) => void;

type RedisClientLike = {
	publish: (channel: string, message: string) => Promise<unknown>;
	subscribe: (channel: string, listener: (message: string, channel: string) => void) => Promise<unknown>;
	unsubscribe?: (channel: string, listener: (message: string, channel: string) => void) => Promise<unknown>;
	quit?: () => Promise<unknown>;
	on: (event: string, listener: (...args: unknown[]) => void) => unknown;
	duplicate?: () => RedisClientLike;
};

export type NotificationBusMode = "local" | "redis" | "postgres";

/** LISTEN/NOTIFY channel of the PostgreSQL mode. */
export const NOTIFICATION_BUS_PG_CHANNEL = "vch_notifications";
/** NOTIFY payloads must stay under 8000 bytes. */
const PG_PAYLOAD_LIMIT = 7_900;

export type NotificationBus = {
	readonly mode: NotificationBusMode;
	/** Fan a message out (locally, or to every instance when Redis backs the bus). */
	publish: (userId: string, message: unknown) => void;
	/** Wire the local delivery handler; only the Redis mode needs async setup. */
	start: (deliver: LocalDelivery) => Promise<void>;
	/** Tear down the subscription (process shutdown / tests). */
	stop: () => Promise<void>;
};

type BusState = {
	deliver: LocalDelivery | null;
	publisher: RedisClientLike | null;
	subscriber: RedisClientLike | null;
	subscribed: boolean;
};

const state: BusState = { deliver: null, publisher: null, subscriber: null, subscribed: false };
let publisherConnecting: Promise<RedisClientLike | null> | null = null;

function handleMessage(raw: string) {
	if (!state.deliver) return;
	try {
		const parsed = JSON.parse(raw) as { userId?: unknown; message?: unknown };
		if (typeof parsed.userId !== "string" || parsed.message === undefined) return;
		state.deliver(parsed.userId, parsed.message);
	} catch (error) {
		logger.warn("dropped malformed notification bus payload", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function connectRedisClient(url: string, purpose: string): Promise<RedisClientLike> {
	// Dynamic require — redis is an optional dependency (see rate-limit-store).
	const redisModule = (await import("redis")) as unknown as {
		createClient: (opts: { url: string }) => RedisClientLike;
	};
	const client = redisModule.createClient({ url });
	// An EventEmitter 'error' with no listener throws; a Redis outage must
	// degrade to local delivery instead of crashing the web process.
	client.on("error", (err: unknown) => {
		logger.warn(`notification bus ${purpose} client error`, {
			error: err instanceof Error ? err.message : String(err),
		});
	});
	await (client as unknown as { connect: () => Promise<unknown> }).connect();
	return client;
}

function ensurePublisher(url: string): Promise<RedisClientLike | null> {
	if (state.publisher) return Promise.resolve(state.publisher);
	if (publisherConnecting) return publisherConnecting;
	publisherConnecting = connectRedisClient(url, "publisher")
		.then((client) => {
			state.publisher = client;
			return client;
		})
		.catch((error: unknown) => {
			logger.warn("notification bus publisher unavailable", {
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		})
		.finally(() => {
			publisherConnecting = null;
		});
	return publisherConnecting;
}

/**
 * Builds the process-wide bus. Local mode is synchronous and always
 * available; Redis mode activates only when REDIS_URL is set and connects
 * lazily — a failed connect falls back to local delivery for this publish.
 */
function databaseUrl(): string | undefined {
	try {
		return (config as { db?: { url?: string } }).db?.url || undefined;
	} catch {
		return undefined;
	}
}

/** Every string in a JSON-like value cut to `max` characters. */
function shrinkStrings(value: unknown, max: number): unknown {
	if (typeof value === "string") return value.length > max ? value.slice(0, max) : value;
	if (Array.isArray(value)) return value.map((item) => shrinkStrings(item, max));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shrinkStrings(item, max)]));
	}
	return value;
}

/**
 * A notification body cut to fit NOTIFY (8,000 bytes); null when nothing useful fits. Only the message used to be
 * cut, so a long title or long message parameters (an unbounded ticket title) dropped the push without a trace.
 */
export function pgPayload(userId: string, message: unknown): string | null {
	for (const max of [Number.POSITIVE_INFINITY, 1_000, 200, 60]) {
		const candidate = Number.isFinite(max) ? shrinkStrings(message, max) : message;
		const payload = JSON.stringify({ userId, message: candidate });
		if (Buffer.byteLength(payload) <= PG_PAYLOAD_LIMIT) return payload;
	}
	logger.warn("notification bus message too large for NOTIFY; not pushed", { userId, type: (message as { type?: string } | null)?.type });
	return null;
}

type PgListener = { connect(): Promise<unknown>; query(sql: string): Promise<unknown>; on(event: string, listener: (...args: unknown[]) => void): unknown; end(): Promise<unknown> };
let pgListener: PgListener | null = null;
let pgReconnect: ReturnType<typeof setTimeout> | null = null;

async function listenPostgres(url: string): Promise<void> {
	const { Client } = (await import("pg")) as unknown as { Client: new (options: { connectionString: string }) => PgListener };
	const client = new Client({ connectionString: url });
	const retry = () => {
		if (pgListener !== client) return;
		pgListener = null;
		state.subscribed = false;
		void client.end().catch(() => undefined);
		if (!state.deliver || pgReconnect) return;
		pgReconnect = setTimeout(() => {
			pgReconnect = null;
			if (state.deliver) void listenPostgres(url).catch((error: unknown) => {
				logger.warn("notification bus LISTEN reconnect failed", { error: error instanceof Error ? error.message : String(error) });
			});
		}, 5_000);
		pgReconnect.unref?.();
	};
	client.on("error", (error: unknown) => {
		logger.warn("notification bus LISTEN connection error", { error: error instanceof Error ? error.message : String(error) });
		retry();
	});
	client.on("end", retry);
	client.on("notification", (event: unknown) => {
		const payload = (event as { payload?: string }).payload;
		if (payload) handleMessage(payload);
	});
	pgListener = client;
	await client.connect();
	await client.query(`LISTEN ${NOTIFICATION_BUS_PG_CHANNEL}`);
	state.subscribed = true;
}

export function getNotificationBus(): NotificationBus {
	const pgUrl = config.redis.url ? undefined : databaseUrl();
	const mode: NotificationBusMode = config.redis.url ? "redis" : pgUrl ? "postgres" : "local";

	if (mode === "postgres") {
		return {
			mode,
			publish(userId, message) {
				// As the Redis mode: a process without a subscription (the
				// worker) delivers nothing itself; the web server's LISTEN does.
				const deliveredLocally = !state.subscribed;
				if (deliveredLocally) state.deliver?.(userId, message);
				const payload = pgPayload(userId, message);
				if (!payload) return;
				void import("@/lib/db")
					.then(({ prisma }) => prisma.$executeRaw`SELECT pg_notify(${NOTIFICATION_BUS_PG_CHANNEL}, ${payload})`)
					.catch((error: unknown) => {
						logger.warn("notification bus NOTIFY failed; delivering locally", { error: error instanceof Error ? error.message : String(error) });
						if (!deliveredLocally) state.deliver?.(userId, message);
					});
			},
			async start(deliver) {
				state.deliver = deliver;
				if (pgListener) return;
				try {
					await listenPostgres(pgUrl!);
					logger.info("notification bus using PostgreSQL LISTEN/NOTIFY", { channel: NOTIFICATION_BUS_PG_CHANNEL });
				} catch (error) {
					logger.warn("notification bus LISTEN setup failed; local delivery only", { error: error instanceof Error ? error.message : String(error) });
				}
			},
			async stop() {
				state.deliver = null;
				state.subscribed = false;
				if (pgReconnect) clearTimeout(pgReconnect);
				pgReconnect = null;
				const client = pgListener;
				pgListener = null;
				await client?.end().catch(() => undefined);
			},
		};
	}

	if (mode === "local") {
		return {
			mode,
			publish(userId, message) {
				state.deliver?.(userId, message);
			},
			async start(deliver) {
				state.deliver = deliver;
			},
			async stop() {
				state.deliver = null;
			},
		};
	}

	const url = config.redis.url!;
	return {
		mode,
		publish(userId, message) {
			// The standalone worker has no WebSocket server and never calls
			// start(). Connect on its first publish so its notifications still
			// reach the web instances through Redis.
			// When this process has no subscription, deliver to its own sockets
			// immediately, then also publish for sockets on other instances.
			const deliveredLocally = !state.subscribed;
			if (deliveredLocally) state.deliver?.(userId, message);
			void ensurePublisher(url)
				.then((publisher) => {
					// No publisher (its connection failed) is a failed publish too:
					// returning quietly skipped the local delivery below, and this
					// instance's own sockets got nothing.
					if (!publisher) throw new Error("Redis publisher unavailable");
					return publisher.publish(NOTIFICATION_BUS_CHANNEL, JSON.stringify({ userId, message }));
				})
				.catch((error: unknown) => {
					logger.warn("notification bus publish failed; delivering locally", {
						error: error instanceof Error ? error.message : String(error),
					});
					if (!deliveredLocally) state.deliver?.(userId, message);
				});
		},
		async start(deliver) {
			state.deliver = deliver;
			// Publisher setup may already be in flight from a worker-style publish.
			// Subscriber setup is independent so a publisher outage does not
			// prevent this process from receiving other instances' messages.
			await ensurePublisher(url);
			if (!state.subscriber) {
				try {
					state.subscriber = await connectRedisClient(url, "subscriber");
					logger.info("notification bus using Redis pub/sub", {
						channel: NOTIFICATION_BUS_CHANNEL,
					});
				} catch (error) {
					// Local delivery stays active; a later start() can retry.
					logger.warn("notification bus Redis setup failed; local delivery only", {
						error: error instanceof Error ? error.message : String(error),
					});
					return;
				}
			}
			if (!state.subscribed) {
				try {
					await state.subscriber.subscribe(NOTIFICATION_BUS_CHANNEL, handleMessage);
					state.subscribed = true;
				} catch (error) {
					logger.warn("notification bus subscription failed; local delivery only", {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}
		},
		async stop() {
			state.deliver = null;
			state.subscribed = false;
			const subscriber = state.subscriber;
			const publisher = state.publisher;
			state.subscriber = null;
			state.publisher = null;
			try {
				if (subscriber?.unsubscribe) {
					await subscriber.unsubscribe(NOTIFICATION_BUS_CHANNEL, handleMessage);
				}
				await Promise.allSettled([subscriber?.quit?.(), publisher?.quit?.()]);
			} catch (error) {
				logger.warn("notification bus teardown error", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
	};
}

/** Test hook: reset the module-level connection state between cases. */
export function resetNotificationBusForTests() {
	state.deliver = null;
	state.publisher = null;
	state.subscriber = null;
	state.subscribed = false;
	publisherConnecting = null;
}

/** Test hook: inject a pre-connected publisher/subscriber pair. */
export function setNotificationBusClientsForTests(
	publisher: RedisClientLike | null,
	subscriber: RedisClientLike | null,
) {
	state.publisher = publisher;
	state.subscriber = subscriber;
}
