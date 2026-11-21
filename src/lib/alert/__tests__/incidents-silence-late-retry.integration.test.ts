// @vitest-environment node
/**
 * Escalation against silence windows and a late level-1 retry, on a real
 * PostgreSQL (RUN_DATABASE_INTEGRATION_TESTS=1, isolated database).
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
const refused = () => ({ ok: false, error: "HTTP 503" });

describe.skipIf(!RUN)("alert escalation: silence windows and late retries (PostgreSQL)", () => {
	const prefix = `esc2-${randomUUID().slice(0, 8)}`;
	const fire = (ruleId: string) => openOrRefreshAlertIncident({
		ruleId,
		ruleName: ruleId,
		serverId: null,
		serverName: "vps",
		metric: "cpu_usage",
		operator: "gte",
		threshold: 90,
		value: 95,
		notifyChannels: ["webhook"],
		webhookUrl: "https://hooks.example.test/alert",
		title: "CPU high",
		message: "cpu high",
		escalationMinutes: 15,
	});
	const incident = (ruleId: string) => prisma.alertIncident.findUniqueOrThrow({ where: { fingerprint: buildAlertFingerprint(ruleId, null, "cpu_usage") } });
	const overdue = (ruleId: string) => prisma.alertIncident.update({
		where: { fingerprint: buildAlertFingerprint(ruleId, null, "cpu_usage") },
		data: { lastNotifiedAt: new Date(Date.now() - 20 * 60_000) },
	});
	const rule = (id: string, silenceWindows: string[]) => prisma.alertRule.create({
		data: {
			id, name: id, metric: "cpu_usage", operator: "gte", threshold: 90, serverIds: [], silenceWindows,
			notifyChannels: ["webhook"], webhookUrl: "https://hooks.example.test/alert", escalationMinutes: 15,
		},
	});

	beforeAll(async () => {
		const db = new URL(process.env.DATABASE_URL!);
		if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
			throw new Error("requires an isolated database");
		}
	});
	beforeEach(() => {
		webhookMock.mockReset();
		webhookMock.mockResolvedValue(delivered());
	});
	afterAll(async () => {
		await prisma.alertRule.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("holds the escalation during a whole-day silence window", async () => {
		const ruleId = `${prefix}-silent`;
		await rule(ruleId, []);
		await fire(ruleId);
		// Silenced afterwards ("00:00-00:00" is the whole day).
		await prisma.alertRule.update({ where: { id: ruleId }, data: { silenceWindows: ["00:00-00:00"] } });
		await overdue(ruleId);
		webhookMock.mockClear();
		await expect(escalateOverdueAlertIncidents({ ruleTeamWhere: { id: ruleId } })).resolves.toMatchObject({ escalated: 0 });
		expect(webhookMock).not.toHaveBeenCalled();
		expect((await incident(ruleId)).level).toBe(1);

		// Once the window is lifted the held escalation goes out.
		await prisma.alertRule.update({ where: { id: ruleId }, data: { silenceWindows: [] } });
		await expect(escalateOverdueAlertIncidents({ ruleTeamWhere: { id: ruleId } })).resolves.toMatchObject({ escalated: 1 });
		expect((await incident(ruleId)).level).toBe(2);
	});

	it("a level-1 retry that answers after an escalation does not clear the level-2 retry", async () => {
		const ruleId = `${prefix}-race`;
		await rule(ruleId, []);
		webhookMock.mockResolvedValueOnce(refused());
		await fire(ruleId);
		expect((await incident(ruleId)).pendingNotifyChannels).toEqual(["webhook"]);

		// The level-1 retry is claimed and its (successful) answer is held back.
		await prisma.alertIncident.update({
			where: { fingerprint: buildAlertFingerprint(ruleId, null, "cpu_usage") },
			data: { nextNotifyAt: new Date(Date.now() - 1_000), lastNotifiedAt: new Date(Date.now() - 20 * 60_000) },
		});
		let release!: (value: unknown) => void;
		webhookMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
		const retry = fire(ruleId);
		await vi.waitFor(() => expect(webhookMock).toHaveBeenCalledTimes(2));

		// Meanwhile the incident escalates and the level-2 webhook fails.
		webhookMock.mockResolvedValueOnce(refused());
		await expect(escalateOverdueAlertIncidents({ ruleTeamWhere: { id: ruleId } })).resolves.toMatchObject({ escalated: 1 });
		const escalated = await incident(ruleId);
		expect(escalated).toMatchObject({ level: 2, pendingNotifyChannels: ["webhook"] });
		expect(escalated.nextNotifyAt).not.toBeNull();

		release(delivered());
		await retry;
		const after = await incident(ruleId);
		expect(after).toMatchObject({ level: 2, pendingNotifyChannels: ["webhook"] });
		expect(after.nextNotifyAt).not.toBeNull();
	});

	it("ignores a late escalation result after a new opening has reached the same level", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			const ruleId = prefix + "-new-round";
			await rule(ruleId, []);
			await fire(ruleId);
			vi.setSystemTime(Date.now() + 16 * 60_000);
			let entered!: () => void;
			const sending = new Promise<void>((resolve) => { entered = resolve; });
			let finish!: (response: ReturnType<typeof refused>) => void;
			webhookMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; entered(); }));
			const sweep = () => escalateOverdueAlertIncidents({ ruleTeamWhere: { id: ruleId } });
			const first = sweep();
			await sending;
			await prisma.alertIncident.updateMany({ where: { ruleId }, data: { status: "RESOLVED", resolvedAt: new Date() } });
			await fire(ruleId);
			vi.setSystemTime(Date.now() + 16 * 60_000);
			expect((await sweep()).escalated).toBe(1);
			finish(refused());
			await first;
			expect(await incident(ruleId)).toMatchObject({ level: 2, pendingNotifyChannels: [], nextNotifyAt: null, notifyAttempts: 1 });
		} finally {
			vi.useRealTimers();
		}
	});

	it("rechecks silence as the scan moves between overdue incidents", async () => {
		const ids = [prefix + "-boundary-a", prefix + "-boundary-b"];
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			vi.setSystemTime(new Date("2026-05-25T13:30:00Z"));
			for (const id of ids) { await rule(id, ["22:00-23:00"]); await fire(id); }
			vi.setSystemTime(new Date("2026-05-25T13:59:59Z"));
			webhookMock.mockImplementationOnce(async () => { vi.setSystemTime(new Date("2026-05-25T14:00:01Z")); return delivered(); });
			const sweep = () => escalateOverdueAlertIncidents({ ruleTeamWhere: { id: { in: ids } } });
			expect((await sweep()).escalated).toBe(1);
			expect((await Promise.all(ids.map(incident))).map((i) => i.level).sort()).toEqual([1, 2]);
			vi.setSystemTime(new Date("2026-05-25T15:01:00Z"));
			await sweep();
			expect((await Promise.all(ids.map(incident))).every((i) => i.level >= 2)).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});
