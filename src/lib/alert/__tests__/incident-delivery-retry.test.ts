import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A channel that fails when an incident fires must be retried while the
 * incident stays open — without re-opening it and without re-sending to the
 * channels that already delivered. The incident store below honours the
 * where-clauses the implementation uses, so concurrent claims behave like the
 * database would.
 */
type Row = Record<string, unknown> & { id: string; fingerprint: string };

const { store, sendEmail, webhook, faults } = vi.hoisted(() => ({
	store: new Map<string, Record<string, unknown> & { id: string; fingerprint: string }>(),
	/** Process death / database failure injection, consumed once. */
	faults: { userLookup: 0, updateMany: 0 },
	sendEmail: vi.fn(),
	webhook: vi.fn(),
}));

function matches(row: Row, where: Record<string, unknown>): boolean {
	return Object.entries(where).every(([key, expected]) => {
		const actual = row[key];
		if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
		if (expected && typeof expected === "object" && "lte" in (expected as object)) {
			return actual instanceof Date && actual.getTime() <= ((expected as { lte: Date }).lte).getTime();
		}
		return actual === expected;
	});
}

function apply(row: Row, data: Record<string, unknown>) {
	for (const [key, value] of Object.entries(data)) {
		if (value && typeof value === "object" && "increment" in (value as object)) {
			row[key] = (row[key] as number) + (value as { increment: number }).increment;
		} else row[key] = value;
	}
	return row;
}

vi.mock("@/lib/db", () => ({
	isUniqueViolation: () => false,
	prisma: {
		alertIncident: {
			findUnique: vi.fn(async ({ where }: { where: { fingerprint?: string; id?: string } }) => {
				const row = [...store.values()].find((item) => (where.id ? item.id === where.id : item.fingerprint === where.fingerprint));
				return row ? { ...row } : null;
			}),
			create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
				const row = { id: `inc-${store.size + 1}`, pendingNotifyChannels: [], notifyAttempts: 0, nextNotifyAt: null, lastNotifyError: null, acknowledgedAt: null, ...data } as unknown as Row;
				store.set(row.id, row);
				return { ...row };
			}),
			findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ ...store.get(where.id)! })),
			update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ ...apply(store.get(where.id)!, data) })),
			updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
				if (faults.updateMany > 0) {
					faults.updateMany -= 1;
					throw new Error("bookkeeping write failed (injected)");
				}
				let count = 0;
				for (const row of store.values()) {
					if (matches(row, where)) {
						apply(row, data);
						count += 1;
					}
				}
				return { count };
			}),
		},
		user: {
			findMany: vi.fn(async () => {
				if (faults.userLookup > 0) {
					faults.userLookup -= 1;
					throw new Error("process killed before sending (injected)");
				}
				return [{ id: "admin1" }];
			}),
		},
	},
}));
vi.mock("@/lib/notification/service", () => ({ createNotification: vi.fn(async () => ({})) }));
vi.mock("@/lib/notification/email", () => ({ sendAlertEmail: sendEmail }));
vi.mock("@/lib/notification/telegram", () => ({ sendAlertTelegram: vi.fn() }));
vi.mock("@/lib/security/webhook-url", () => ({ fetchWebhookSafely: webhook }));

import { acknowledgeAlertIncident, openOrRefreshAlertIncident, resolveAlertIncident } from "../incidents";

const fire = {
	ruleId: "rule-1",
	ruleName: "CPU",
	serverId: "srv-1",
	serverName: "web-1",
	metric: "cpu_usage",
	operator: ">",
	threshold: 90,
	value: 97,
	notifyChannels: ["email", "webhook"],
	webhookUrl: "https://hooks.example.test/alert",
	onCallUserIds: [],
	title: "CPU high",
	message: "cpu 97",
};

const webhookDown = { ok: true, response: { ok: false, status: 503, statusText: "Service Unavailable" } };
const webhookUp = { ok: true, response: { ok: true, status: 200 } };

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
	store.clear();
	Object.assign(faults, { userLookup: 0, updateMany: 0 });
	sendEmail.mockReset().mockResolvedValue({ accepted: ["ops@example.test"], rejected: [] });
	webhook.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

const minutes = (n: number) => vi.setSystemTime(new Date(Date.now() + n * 60_000));

describe("alert notification delivery retry", () => {
	it("re-delivers only the failed channel on a later evaluation while the incident stays open", async () => {
		webhook.mockResolvedValueOnce(webhookDown);
		const first = await openOrRefreshAlertIncident(fire);
		expect(first).toMatchObject({ fired: true, notified: true, deliveredChannels: ["email"] });
		expect(first.failedChannels?.map((item) => item.channel)).toEqual(["webhook"]);

		// The webhook endpoint recovers; the metric is still over threshold.
		webhook.mockResolvedValue(webhookUp);
		minutes(2);
		const retry = await openOrRefreshAlertIncident(fire);
		expect(retry).toMatchObject({ fired: false, notified: true, deliveredChannels: ["webhook"] });
		expect(webhook).toHaveBeenCalledTimes(2);
		expect(sendEmail).toHaveBeenCalledTimes(1); // no duplicate page on the channel that worked
		expect(store.get(first.incidentId)).toMatchObject({ status: "OPEN", pendingNotifyChannels: [], nextNotifyAt: null });

		// Nothing left to deliver: further evaluations stay quiet.
		minutes(10);
		await openOrRefreshAlertIncident(fire);
		expect(webhook).toHaveBeenCalledTimes(2);
	});

	it("an incident opened by a process that died before sending is still notified later", async () => {
		faults.userLookup = 1;
		await expect(openOrRefreshAlertIncident(fire)).rejects.toThrow(/before sending/);
		expect(sendEmail).not.toHaveBeenCalled();
		const row = [...store.values()][0]!;
		expect(row).toMatchObject({ status: "OPEN", pendingNotifyChannels: ["email", "webhook"], notifyAttempts: 1 });

		webhook.mockResolvedValue(webhookUp);
		minutes(2);
		const later = await openOrRefreshAlertIncident(fire);
		expect(later.fired).toBe(false);
		expect([...(later.deliveredChannels ?? [])].sort()).toEqual(["email", "webhook"]);
		expect(sendEmail).toHaveBeenCalledTimes(1);
		expect(webhook).toHaveBeenCalledTimes(1);
	});

	it("a failed delivery whose bookkeeping also failed is still retried (at least once)", async () => {
		webhook.mockResolvedValueOnce(webhookDown).mockResolvedValue(webhookUp);
		faults.updateMany = 1;
		const first = await openOrRefreshAlertIncident(fire);
		expect(first).toMatchObject({ fired: true, deliveredChannels: ["email"] });

		minutes(2);
		const later = await openOrRefreshAlertIncident(fire);
		expect(later.deliveredChannels).toContain("webhook");
		expect(webhook).toHaveBeenCalledTimes(2);
		// At-least-once: email had delivered, but its success was never recorded.
		expect(sendEmail).toHaveBeenCalledTimes(2);
	});

	it("re-sends the escalation copy, not the fired one, to a channel that missed an escalation", async () => {
		// An incident escalated to L2 whose webhook failed at escalation time.
		const escalatedAt = new Date(Date.now() - 5 * 60_000);
		store.set("inc-esc", {
			id: "inc-esc",
			fingerprint: `${fire.ruleId}::${fire.serverId}::${fire.metric}`,
			status: "OPEN",
			level: 2,
			title: fire.title,
			message: fire.message,
			serverName: fire.serverName,
			metric: fire.metric,
			createdAt: new Date(Date.now() - 60 * 60_000),
			lastNotifiedAt: escalatedAt,
			escalatedAt,
			pendingNotifyChannels: ["webhook"],
			notifyAttempts: 1,
			nextNotifyAt: new Date(Date.now() - 60_000),
			lastNotifyError: "webhook: 503",
		});
		webhook.mockResolvedValue(webhookUp);

		const later = await openOrRefreshAlertIncident({ ...fire, escalationMinutes: 15 });
		expect(later).toMatchObject({ fired: false, notified: true, deliveredChannels: ["webhook"], level: 2 });
		expect(sendEmail).not.toHaveBeenCalled(); // email had received the escalation
		expect(webhook).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(webhook.mock.calls[0])).toContain("escalated to L2 (no acknowledgement within 15m)");
		expect(store.get("inc-esc")).toMatchObject({ level: 2, pendingNotifyChannels: [], nextNotifyAt: null });
	});

	it("reopening replaces the previous round's delivery state before sending", async () => {
		store.set("inc-old", {
			id: "inc-old",
			fingerprint: `${fire.ruleId}::${fire.serverId}::${fire.metric}`,
			status: "RESOLVED",
			level: 1,
			lastNotifiedAt: new Date("2026-10-01T00:00:00Z"),
			pendingNotifyChannels: ["webhook"],
			notifyAttempts: 8,
			nextNotifyAt: null,
			lastNotifyError: "old round",
		} as Row);
		faults.userLookup = 1;
		await expect(openOrRefreshAlertIncident(fire)).rejects.toThrow(/before sending/);
		expect(store.get("inc-old")).toMatchObject({ status: "OPEN", pendingNotifyChannels: ["email", "webhook"], notifyAttempts: 1, lastNotifyError: null });

		webhook.mockResolvedValue(webhookUp);
		minutes(2);
		const later = await openOrRefreshAlertIncident(fire);
		expect([...(later.deliveredChannels ?? [])].sort()).toEqual(["email", "webhook"]);
	});

	it("backs off between attempts and stops after the attempt limit", async () => {
		webhook.mockResolvedValue(webhookDown);
		const first = await openOrRefreshAlertIncident(fire);
		// Immediately re-evaluated: not yet due.
		await openOrRefreshAlertIncident(fire);
		expect(webhook).toHaveBeenCalledTimes(1);
		for (let i = 0; i < 20; i += 1) {
			minutes(61);
			await openOrRefreshAlertIncident(fire);
		}
		const row = store.get(first.incidentId)!;
		expect(webhook.mock.calls.length).toBe(row.notifyAttempts);
		expect(row.notifyAttempts).toBeLessThanOrEqual(8);
		expect(row).toMatchObject({ pendingNotifyChannels: ["webhook"], nextNotifyAt: null });
		expect(String(row.lastNotifyError)).toMatch(/503/);
	});

	it("does not retry once a human acknowledged the incident or it resolved", async () => {
		webhook.mockResolvedValue(webhookDown);
		const first = await openOrRefreshAlertIncident(fire);
		await acknowledgeAlertIncident({ incidentId: first.incidentId, userId: "admin1" });
		minutes(5);
		await openOrRefreshAlertIncident(fire);
		expect(webhook).toHaveBeenCalledTimes(1);

		store.clear();
		const second = await openOrRefreshAlertIncident(fire);
		await resolveAlertIncident({ ...fire, notifyChannels: [] });
		expect(store.get(second.incidentId)).toMatchObject({ status: "RESOLVED", pendingNotifyChannels: [], nextNotifyAt: null });
	});
});
