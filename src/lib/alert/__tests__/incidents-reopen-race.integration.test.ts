// @vitest-environment node
/**
 * Two evaluations (the worker and a manual run) that both read a RESOLVED
 * incident and both see the metric over its threshold again: against a real,
 * isolated PostgreSQL only one of them may reopen it, notify and report a fire
 * (callers start the linked playbook for every fire).
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

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("reopening a resolved alert concurrently (PostgreSQL)", () => {
	const ruleId = `reopen-${randomUUID().slice(0, 8)}`;
	const fingerprint = buildAlertFingerprint(ruleId, null, "disk_usage");
	const fire = () => openOrRefreshAlertIncident({
		ruleId, ruleName: "Reopen rule", serverId: null, serverName: "vps-reopen", metric: "disk_usage", operator: "gte", threshold: 90, value: 96,
		notifyChannels: ["webhook"], webhookUrl: "https://hooks.example.test/alert", title: "Disk high", message: "disk high",
	});

	beforeAll(async () => {
		const db = new URL(process.env.DATABASE_URL!);
		if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
			throw new Error("The alert reopen integration test requires an isolated database");
		}
		await prisma.alertRule.create({
			data: { id: ruleId, name: "Reopen rule", metric: "disk_usage", operator: "gte", threshold: 90, serverIds: [], notifyChannels: ["webhook"], webhookUrl: "https://hooks.example.test/alert" },
		});
		webhookMock.mockResolvedValue({ ok: true, response: { ok: true, status: 200 } });
	});
	afterAll(async () => {
		await prisma.alertIncident.deleteMany({ where: { fingerprint } });
		await prisma.alertRule.deleteMany({ where: { id: ruleId } });
		await prisma.$disconnect();
	});

	it("lets exactly one caller reopen, notify and report the fire", async () => {
		await fire();
		await prisma.alertIncident.update({ where: { fingerprint }, data: { status: "RESOLVED", resolvedAt: new Date(), lastNotifiedAt: new Date(Date.now() - 3_600_000) } });
		webhookMock.mockClear();

		// Both callers read the RESOLVED snapshot before either writes.
		const findUnique = prisma.alertIncident.findUnique.bind(prisma.alertIncident);
		let arrived = 0;
		let release!: () => void;
		const bothRead = new Promise<void>((resolve) => { release = resolve; });
		const spy = vi.spyOn(prisma.alertIncident, "findUnique").mockImplementation((async (args: Parameters<typeof findUnique>[0]) => {
			const row = await findUnique(args);
			if (arrived < 2) {
				arrived += 1;
				if (arrived === 2) release();
				await bothRead;
			}
			return row;
		}) as never);
		const results = await Promise.all([fire(), fire()]);
		spy.mockRestore();

		expect(arrived).toBe(2);
		expect(results.map((result) => result.fired).sort()).toEqual([false, true]);
		expect(webhookMock).toHaveBeenCalledTimes(1);
		expect(await prisma.alertIncident.findUniqueOrThrow({ where: { fingerprint } })).toMatchObject({ status: "OPEN" });
	});
});
