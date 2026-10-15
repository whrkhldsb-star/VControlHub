// @vitest-environment node
/**
 * Escalation-minutes snapshot against a real, isolated PostgreSQL
 * (RUN_DATABASE_INTEGRATION_TESTS=1, loopback host, database name containing
 * audit/test/_ci). Unlike the mocked unit tests, a column the incident reads
 * miss (or a migration that never added it) fails here.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

const { webhookMock } = vi.hoisted(() => ({ webhookMock: vi.fn() }));
vi.mock("@/lib/security/webhook-url", async (importOriginal) => ({
	...await importOriginal<typeof import("@/lib/security/webhook-url")>(),
	fetchWebhookSafely: webhookMock,
}));

const { buildAlertFingerprint, escalateOverdueAlertIncidents, openOrRefreshAlertIncident } = await import("../incidents");

const RUN = process.env.RUN_DATABASE_INTEGRATION_TESTS === "1";

const delivered = () => ({ ok: true, response: { ok: true, status: 200 } });
const sentMessages = () => webhookMock.mock.calls.map((call) => JSON.parse(String(call[1].body)).message as string);

describe.skipIf(!RUN)("alert escalation minutes snapshot (PostgreSQL)", () => {
	const ruleId = `esc-${randomUUID().slice(0, 8)}`;
	const fingerprint = buildAlertFingerprint(ruleId, null, "cpu_usage");
	const fire = (escalationMinutes: number) => openOrRefreshAlertIncident({
		ruleId,
		ruleName: "Snapshot rule",
		serverId: null,
		serverName: "vps-snapshot",
		metric: "cpu_usage",
		operator: "gte",
		threshold: 90,
		value: 95,
		notifyChannels: ["webhook"],
		webhookUrl: "https://hooks.example.test/alert",
		title: "CPU high",
		message: "cpu high",
		escalationMinutes,
	});
	const incident = () => prisma.alertIncident.findUniqueOrThrow({ where: { fingerprint } });
	const makeRetryDue = () => prisma.alertIncident.update({ where: { fingerprint }, data: { nextNotifyAt: new Date(Date.now() - 1_000) } });

	beforeAll(async () => {
		const db = new URL(process.env.DATABASE_URL!);
		if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
			throw new Error("The alert escalation integration test requires an isolated database");
		}
		await prisma.alertRule.create({
			data: {
				id: ruleId, name: "Snapshot rule", metric: "cpu_usage", operator: "gte", threshold: 90, serverIds: [],
				notifyChannels: ["webhook"], webhookUrl: "https://hooks.example.test/alert", escalationMinutes: 15,
			},
		});
	});

	beforeEach(() => {
		webhookMock.mockReset();
		webhookMock.mockResolvedValue(delivered());
	});

	afterAll(async () => {
		await prisma.alertRule.deleteMany({ where: { id: ruleId } });
		await prisma.$disconnect();
	});

	it("stores the window at escalation and quotes it on retry after the rule changed", async () => {
		await fire(15);
		expect((await incident()).escalationMinutes).toBeNull();

		// Overdue and unacknowledged; the escalation's webhook delivery fails.
		await prisma.alertIncident.update({ where: { fingerprint }, data: { lastNotifiedAt: new Date(Date.now() - 20 * 60_000) } });
		webhookMock.mockResolvedValueOnce({ ok: false, error: "connect ECONNREFUSED" });
		await expect(escalateOverdueAlertIncidents({ ruleTeamWhere: { id: ruleId } })).resolves.toMatchObject({ escalated: 1 });
		expect(await incident()).toMatchObject({ level: 2, escalationMinutes: 15, pendingNotifyChannels: ["webhook"] });

		// The rule is edited before the retry; the evaluator passes the new value.
		await prisma.alertRule.update({ where: { id: ruleId }, data: { escalationMinutes: 60 } });
		await makeRetryDue();
		webhookMock.mockClear();
		await expect(fire(60)).resolves.toMatchObject({ notified: true, level: 2 });
		expect(sentMessages()).toEqual(["cpu high — escalated to L2 (no acknowledgement within 15m)"]);
		expect((await incident()).pendingNotifyChannels).toEqual([]);
	});

	it("re-escalation refreshes the snapshot from the rule at that moment", async () => {
		await prisma.alertIncident.update({ where: { fingerprint }, data: { lastNotifiedAt: new Date(Date.now() - 61 * 60_000) } });
		await expect(escalateOverdueAlertIncidents({ ruleTeamWhere: { id: ruleId } })).resolves.toMatchObject({ escalated: 1 });
		expect(await incident()).toMatchObject({ level: 3, escalationMinutes: 60 });
		expect(sentMessages()).toEqual(["cpu high — escalated to L3 (no acknowledgement within 60m)"]);
	});

	it("falls back to the rule's current window for rows escalated before the column existed", async () => {
		await prisma.alertIncident.update({
			where: { fingerprint },
			data: { escalationMinutes: null, pendingNotifyChannels: ["webhook"], notifyAttempts: 1 },
		});
		await makeRetryDue();
		await fire(45);
		expect(sentMessages()).toEqual(["cpu high — escalated to L3 (no acknowledgement within 45m)"]);
	});

	it("clears the snapshot when a resolved incident re-opens", async () => {
		await prisma.alertIncident.update({
			where: { fingerprint },
			data: { status: "RESOLVED", resolvedAt: new Date(), escalationMinutes: 60, lastNotifiedAt: new Date(Date.now() - 3_600_000) },
		});
		await expect(fire(60)).resolves.toMatchObject({ fired: true, level: 1 });
		expect(await incident()).toMatchObject({ status: "OPEN", level: 1, escalatedAt: null, escalationMinutes: null });
	});
});
