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

export type NotificationBusMode = "local" | "redis";

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
export function getNotificationBus(): NotificationBus {
	const mode: NotificationBusMode = config.redis.url ? "redis" : "local";

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
					if (!publisher) return;
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
