import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const { configMock, createClientMock } = vi.hoisted(() => ({
	configMock: { redis: { url: undefined as string | undefined } },
	createClientMock: vi.fn(),
}));

vi.mock("@/lib/config/env", () => ({ config: configMock }));
// Never let a test touch the real optional redis package.
vi.mock("redis", () => ({ createClient: createClientMock }));

import {
	getNotificationBus,
	resetNotificationBusForTests,
	setNotificationBusClientsForTests,
	NOTIFICATION_BUS_CHANNEL,
	type LocalDelivery,
} from "../notification-bus";

type Listener = (message: string, channel: string) => void;

function makeFakeRedis() {
	const listeners: Listener[] = [];
	const publishes: Array<{ channel: string; message: string }> = [];
	const client = {
		connect: vi.fn(async () => {}),
		publish: vi.fn(async (channel: string, message: string) => {
			publishes.push({ channel, message });
			// Simulate the broker fanning out to all subscribers (including self).
			for (const listener of [...listeners]) listener(message, channel);
		}),
		subscribe: vi.fn(async (_channel: string, listener: Listener) => {
			listeners.push(listener);
		}),
		unsubscribe: vi.fn(async () => {}),
		quit: vi.fn(async () => {}),
		on: vi.fn(),
	};
	return { client, publishes, listeners };
}

const collected: Array<{ userId: string; message: unknown }> = [];
const deliver: LocalDelivery = (userId, message) => collected.push({ userId, message });

beforeEach(() => {
	resetNotificationBusForTests();
	collected.length = 0;
	configMock.redis.url = undefined;
	createClientMock.mockReset();
	createClientMock.mockImplementation(() => { throw new Error("Redis unavailable in test"); });
});

afterEach(async () => {
	await getNotificationBus().stop();
	resetNotificationBusForTests();
});

describe("notification bus (local mode)", () => {
	it("delivers publishes directly to the registered local handler", async () => {
		const bus = getNotificationBus();
		expect(bus.mode).toBe("local");
		await bus.start(deliver);

		bus.publish("u1", { type: "unread_count", count: 3 });
		expect(collected).toEqual([{ userId: "u1", message: { type: "unread_count", count: 3 } }]);
	});

	it("drops publishes after stop", async () => {
		const bus = getNotificationBus();
		await bus.start(deliver);
		await bus.stop();
		bus.publish("u1", { type: "unread_count", count: 3 });
		expect(collected).toEqual([]);
	});
});

describe("notification bus (redis mode)", () => {
	it("connects and publishes from a standalone worker without start()", async () => {
		configMock.redis.url = "redis://127.0.0.1:6379";
		const { client, publishes } = makeFakeRedis();
		createClientMock.mockReturnValue(client);

		getNotificationBus().publish("worker-user", { type: "unread_count", count: 2 });

		await vi.waitFor(() => expect(publishes).toHaveLength(1));
		expect(client.connect).toHaveBeenCalledTimes(1);
		expect(createClientMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(publishes[0]!.message)).toEqual({
			userId: "worker-user",
			message: { type: "unread_count", count: 2 },
		});
	});

	it("publishes the first message after a WebSocket instance's Redis startup outage", async () => {
		configMock.redis.url = "redis://127.0.0.1:6379";
		const bus = getNotificationBus();
		await bus.start(deliver);
		const { client, publishes } = makeFakeRedis();
		createClientMock.mockReturnValue(client);

		bus.publish("u-first", { type: "unread_count", count: 1 });

		expect(collected).toEqual([{ userId: "u-first", message: { type: "unread_count", count: 1 } }]);
		await vi.waitFor(() => expect(publishes).toHaveLength(1));
		expect(JSON.parse(publishes[0]!.message)).toEqual({
			userId: "u-first",
			message: { type: "unread_count", count: 1 },
		});
	});

	it("keeps local delivery when the Redis subscription fails", async () => {
		configMock.redis.url = "redis://127.0.0.1:6379";
		const { client, publishes } = makeFakeRedis();
		client.subscribe.mockRejectedValueOnce(new Error("subscription outage"));
		setNotificationBusClientsForTests(client, client);

		const bus = getNotificationBus();
		await expect(bus.start(deliver)).resolves.toBeUndefined();
		bus.publish("u-local", { type: "unread_count", count: 4 });

		await vi.waitFor(() => expect(publishes).toHaveLength(1));
		expect(collected).toEqual([{ userId: "u-local", message: { type: "unread_count", count: 4 } }]);
	});

	it("fans out publishes through the channel to the local handler", async () => {
		configMock.redis.url = "redis://127.0.0.1:6379";
		const bus = getNotificationBus();
		expect(bus.mode).toBe("redis");

		// Pre-connected clients skip the real connect path.
		const { client, publishes } = makeFakeRedis();
		setNotificationBusClientsForTests(client, client);

		await bus.start(deliver);
		// start() re-subscribes when subscriber state was replaced.
		expect(client.subscribe).toHaveBeenCalledWith(NOTIFICATION_BUS_CHANNEL, expect.any(Function));

		bus.publish("u2", { type: "notification", data: { id: "n1" } });
		await new Promise((r) => setTimeout(r, 20));
		expect(publishes).toHaveLength(1);
		expect(publishes[0]!.channel).toBe(NOTIFICATION_BUS_CHANNEL);
		expect(JSON.parse(publishes[0]!.message)).toEqual({
			userId: "u2",
			message: { type: "notification", data: { id: "n1" } },
		});
		expect(collected).toEqual([
			{ userId: "u2", message: { type: "notification", data: { id: "n1" } } },
		]);
	});

	it("falls back to local delivery while the publisher is not connected", async () => {
		configMock.redis.url = "redis://127.0.0.1:6379";
		const bus = getNotificationBus();
		setNotificationBusClientsForTests(null, null);
		await bus.start(deliver);

		bus.publish("u3", { type: "unread_count", count: 0 });
		await new Promise((r) => setTimeout(r, 10));
		expect(collected).toEqual([{ userId: "u3", message: { type: "unread_count", count: 0 } }]);
	});

	it("falls back to local delivery when a publish rejects", async () => {
		configMock.redis.url = "redis://127.0.0.1:6379";
		const bus = getNotificationBus();
		const failing = { ...makeFakeRedis().client, publish: vi.fn(async () => { throw new Error("outage"); }) };
		setNotificationBusClientsForTests(failing, failing);
		await bus.start(deliver);

		bus.publish("u4", { type: "unread_count", count: 1 });
		await new Promise((r) => setTimeout(r, 20));
		expect(collected).toEqual([{ userId: "u4", message: { type: "unread_count", count: 1 } }]);
	});

	it("ignores malformed broker payloads instead of throwing", async () => {
		configMock.redis.url = "redis://127.0.0.1:6379";
		const bus = getNotificationBus();
		const { client } = makeFakeRedis();
		setNotificationBusClientsForTests(client, client);
		await bus.start(deliver);

		const listener = (client.subscribe as unknown as Mock).mock.calls[0]![1] as Listener;
		// Malformed / foreign payloads on the channel are dropped silently —
		// neither case may throw or deliver.
		expect(() => listener("{not json", NOTIFICATION_BUS_CHANNEL)).not.toThrow();
		expect(() => listener(JSON.stringify({ noUserId: true }), NOTIFICATION_BUS_CHANNEL)).not.toThrow();
		expect(() => listener(JSON.stringify({ userId: 123, message: {} }), NOTIFICATION_BUS_CHANNEL)).not.toThrow();
		expect(collected).toEqual([]);

		// A well-formed payload still delivers after the malformed ones.
		listener(JSON.stringify({ userId: "u5", message: { type: "unread_count", count: 5 } }), NOTIFICATION_BUS_CHANNEL);
		expect(collected).toEqual([{ userId: "u5", message: { type: "unread_count", count: 5 } }]);
	});
});
