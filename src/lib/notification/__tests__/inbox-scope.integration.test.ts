// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createNotification, deleteNotification, getUnreadCount, listUserNotifications, markAllAsRead, markAsRead, readUnreadCount } from "../service";

import { getVisibleNotificationForPush } from "../inbox";

vi.mock("@/lib/ws/notification-ws", () => ({ pushUnreadCount: vi.fn(), pushNotification: vi.fn() }));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("transferred recipient inbox (PostgreSQL)", () => {
	const userId = `inbox-${randomUUID()}`;
	const teamA = `${userId}-a`;
	const teamB = `${userId}-b`;
	const session = { userId, currentTeamId: teamB, roles: [] };

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || !/test|audit|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback test database");
		}
		await prisma.$transaction(async tx => {
			await tx.team.createMany({ data: [teamA, teamB].map(id => ({ id, name: id, slug: id })) });
			await tx.identityTemplate.create({ data: { id: userId, name: userId, permissions: [] } });
			await tx.user.create({ data: { id: userId, username: userId, passwordHash: "test", status: "ACTIVE", mustChangePassword: false } });
			await tx.teamMember.create({ data: { userId, teamId: teamA, identityTemplateId: userId } });
			await tx.notification.createMany({ data: [
				{ teamId: teamA, type: "system", title: "former" }, { teamId: teamB, type: "system", title: "current" },
				{ teamId: null, type: "announcement", title: "broadcast" }, { teamId: null, type: "system", title: "legacy" },
			].map(row => ({ ...row, userId, message: row.title, id: `${userId}-${row.title}` })) });
			await tx.teamMember.update({ where: { userId }, data: { teamId: teamB } });
		});
	});
	afterAll(async () => {
		await prisma.user.deleteMany({ where: { id: userId } });
		await prisma.identityTemplate.deleteMany({ where: { id: userId } });
		await prisma.team.deleteMany({ where: { id: { in: [teamA, teamB] } } });
		await prisma.$disconnect();
	});

	it("uses the new customer for page, API and socket counts and changes only visible rows", async () => {
		expect((await listUserNotifications(userId)).map(row => row.title).sort()).toEqual(["broadcast", "current"]);
		expect(await getUnreadCount(session)).toBe(2);
		expect(await getVisibleNotificationForPush(userId, `${userId}-former`)).toBeNull();
		expect(await getVisibleNotificationForPush(userId, `${userId}-broadcast`)).toMatchObject({ title: "broadcast" });
		expect((await readUnreadCount(userId)).count).toBe(2);
		await expect(markAsRead(`${userId}-former`, session)).rejects.toThrow();
		await expect(deleteNotification(`${userId}-legacy`, session)).rejects.toThrow();
		expect((await markAllAsRead(session)).count).toBe(2);
		expect((await readUnreadCount(userId)).count).toBe(0);
		const unread = await prisma.notification.findMany({ where: { userId, isRead: false }, select: { title: true } });
		expect(unread.map(row => row.title).sort()).toEqual(["former", "legacy"]);
	});

	it("returns the one stored notification for concurrent attempts with the same delivery id", async () => {
		const id = userId + "-step";
		const send = () => createNotification({ userId, teamId: teamB, type: "playbook", title: "step", message: "done" }, id);
		const rows = await Promise.all([send(), send()]);
		expect(rows.map((row) => row.id)).toEqual([id, id]);
		expect(await prisma.notification.count({ where: { userId, type: "playbook" } })).toBe(1);
		const { pushNotification } = await import("@/lib/ws/notification-ws");
		expect(pushNotification).toHaveBeenCalledOnce();
	});
	it("revokes an existing incident notification from the inbox, unread count and socket", async () => {
		const id = userId + "-incident";
		await prisma.server.create({ data: { id, teamId: teamB, name: id, username: "test", host: "localhost", tags: [] } });
		await prisma.alertRule.create({ data: { id, teamId: teamB, name: id, metric: "cpu_usage", operator: "gt", threshold: 80 } });
		try {
			await prisma.alertIncident.create({ data: { id, ruleId: id, serverId: id, serverName: id, fingerprint: id, metric: "cpu_usage", operator: "gt", threshold: 80, value: 95, title: "CPU", message: "High" } });
			await prisma.notification.create({ data: { id, userId, teamId: teamB, type: "server_alert", actionUrl: `/alert-rules?incident=${id}`, title: "CPU", message: "High" } });
			const count = await getUnreadCount(session);
			expect(await getVisibleNotificationForPush(userId, id)).toMatchObject({ id });
			await prisma.userServerAccess.create({ data: { userId, serverId: id, canRead: false } });
			expect(await getVisibleNotificationForPush(userId, id)).toBeNull();
			expect((await listUserNotifications(session)).some((row) => row.id === id)).toBe(false);
			expect(await getUnreadCount(session)).toBe(count - 1);
			expect((await readUnreadCount(userId)).count).toBe(count - 1);
		} finally {
			await prisma.alertRule.delete({ where: { id } });
			await prisma.server.delete({ where: { id } });
		}
	});

});
