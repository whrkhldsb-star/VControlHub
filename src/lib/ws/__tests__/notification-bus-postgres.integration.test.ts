// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Without Redis, notifications created by the standalone worker reach the
 * web server's WebSockets through PostgreSQL LISTEN/NOTIFY. Before, the
 * worker's in-process delivery had no sockets and the notice never arrived
 * until a page reload.
 */
import { getNotificationBus, resetNotificationBusForTests } from "../notification-bus";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1" || Boolean(process.env.REDIS_URL))("notification bus over PostgreSQL LISTEN/NOTIFY", () => {
	afterAll(async () => {
		await getNotificationBus().stop();
		resetNotificationBusForTests();
		const { prisma } = await import("@/lib/db");
		await prisma.$disconnect();
	});

	it("delivers a notice published by another process", async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		const bus = getNotificationBus();
		expect(bus.mode).toBe("postgres");
		const delivered: Array<{ userId: string; message: unknown }> = [];
		await bus.start((userId, message) => delivered.push({ userId, message }));

		// "Another process": a plain NOTIFY on the channel, as the worker's publish sends.
		const { prisma } = await import("@/lib/db");
		const payload = JSON.stringify({ userId: "u-worker", message: { type: "notification", data: { title: "backup done" } } });
		await prisma.$executeRaw`SELECT pg_notify('vch_notifications', ${payload})`;
		await vi.waitFor(() => expect(delivered).toEqual([{ userId: "u-worker", message: { type: "notification", data: { title: "backup done" } } }]), { timeout: 5_000 });

		// This process's own publish comes back through the same channel, once.
		bus.publish("u-web", { type: "unread_count", count: 3 });
		await vi.waitFor(() => expect(delivered).toHaveLength(2), { timeout: 5_000 });
		expect(delivered[1]).toEqual({ userId: "u-web", message: { type: "unread_count", count: 3 } });
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(delivered).toHaveLength(2);
	});
});

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("unread count read time (PostgreSQL)", () => {
	it("stamps each count with when it was read, later reads later", async () => {
		const { readUnreadCount } = await import("@/lib/notification/service");
		const first = await readUnreadCount("no-such-user");
		const second = await readUnreadCount("no-such-user");
		expect(first.count).toBe(0);
		expect(second.asOfUs).toBeGreaterThan(first.asOfUs);
		expect(Math.abs(second.asOfUs / 1000 - Date.now())).toBeLessThan(60_000);
	});
});
