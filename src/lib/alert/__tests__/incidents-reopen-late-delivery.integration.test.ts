// @vitest-environment node
/**
 * The first notice of an incident was still being sent when the metric
 * recovered and fired again: the same incident row (same id, OPEN, level 1)
 * was opened again and its webhook failed, leaving a retry pending. The first
 * send then finished and its write-back, matching id/OPEN/level 1, cleared the
 * new round's pending channel, error and retry time.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

const { webhookMock } = vi.hoisted(() => ({ webhookMock: vi.fn() }));
vi.mock("@/lib/security/webhook-url", async (importOriginal) => ({
	...await importOriginal<typeof import("@/lib/security/webhook-url")>(),
	fetchWebhookSafely: webhookMock,
}));

const { buildAlertFingerprint, openOrRefreshAlertIncident } = await import("../incidents");

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("a late first notice after the incident opened again (PostgreSQL)", () => {
	const ruleId = `late-${randomUUID().slice(0, 8)}`;
	const fingerprint = buildAlertFingerprint(ruleId, null, "cpu_usage");
	const fire = () => openOrRefreshAlertIncident({
		ruleId, ruleName: "Late rule", serverId: null, serverName: "vps-late", metric: "cpu_usage", operator: "gte", threshold: 90, value: 97,
		notifyChannels: ["webhook"], webhookUrl: "https://hooks.example.test/alert", title: "CPU high", message: "cpu high",
	});

	beforeAll(async () => {
		const db = new URL(process.env.DATABASE_URL!);
		if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
			throw new Error("The alert delivery integration test requires an isolated database");
		}
		await prisma.alertRule.create({
			data: { id: ruleId, name: "Late rule", metric: "cpu_usage", operator: "gte", threshold: 90, serverIds: [], notifyChannels: ["webhook"], webhookUrl: "https://hooks.example.test/alert" },
		});
	});
	afterAll(async () => {
		await prisma.alertIncident.deleteMany({ where: { fingerprint } });
		await prisma.alertRule.deleteMany({ where: { id: ruleId } });
		await prisma.$disconnect();
	});

	it("keeps the new round's pending retry", async () => {
		let releaseFirst!: () => void;
		webhookMock.mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve({ ok: true, response: { ok: true, status: 200 } }); }));
		const first = fire();
		await vi.waitFor(() => expect(webhookMock).toHaveBeenCalledTimes(1));

		// Recovered, then over the threshold again; this round's webhook fails.
		await prisma.alertIncident.update({ where: { fingerprint }, data: { status: "RESOLVED", resolvedAt: new Date(), lastNotifiedAt: new Date(Date.now() - 3_600_000) } });
		webhookMock.mockResolvedValueOnce({ ok: true, response: { ok: false, status: 503 } });
		await fire();
		const pending = await prisma.alertIncident.findUniqueOrThrow({ where: { fingerprint } });
		expect(pending.pendingNotifyChannels).toEqual(["webhook"]);

		releaseFirst();
		await first;
		const after = await prisma.alertIncident.findUniqueOrThrow({ where: { fingerprint } });
		expect(after.pendingNotifyChannels).toEqual(["webhook"]);
		expect(after.nextNotifyAt).not.toBeNull();
		expect(after.lastNotifyError).not.toBeNull();
	});
});
