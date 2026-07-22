import { beforeEach, describe, it, expect, vi } from "vitest";

const { prismaMocks, txMocks, loggerMocks } = vi.hoisted(() => ({
	prismaMocks: { findMany: vi.fn(), transaction: vi.fn() },
	txMocks: {
		updateMany: vi.fn(),
		createEscalation: vi.fn(),
		findManagers: vi.fn(),
		createNotifications: vi.fn(),
	},
	loggerMocks: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		ticket: { findMany: prismaMocks.findMany },
		$transaction: prismaMocks.transaction,
	},
}));
vi.mock("@/lib/logging", () => ({ createLogger: () => loggerMocks }));

import { computeSlaDueAt, escalateBreachedTickets, isSlaBreached, getSlaStatus, SLA_DURATIONS_MS } from "../sla";

describe("ticket SLA service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		txMocks.updateMany.mockResolvedValue({ count: 1 });
		txMocks.createEscalation.mockResolvedValue({});
		txMocks.findManagers.mockResolvedValue([]);
		txMocks.createNotifications.mockResolvedValue({ count: 0 });
		prismaMocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
			ticket: { updateMany: txMocks.updateMany },
			ticketEscalation: { create: txMocks.createEscalation },
			user: { findMany: txMocks.findManagers },
			notification: { createMany: txMocks.createNotifications },
		}));
	});

	describe("SLA_DURATIONS_MS", () => {
		it("defines durations for all priority levels", () => {
			expect(SLA_DURATIONS_MS.URGENT).toBe(2 * 60 * 60 * 1000);
			expect(SLA_DURATIONS_MS.HIGH).toBe(8 * 60 * 60 * 1000);
			expect(SLA_DURATIONS_MS.NORMAL).toBe(24 * 60 * 60 * 1000);
			expect(SLA_DURATIONS_MS.LOW).toBe(72 * 60 * 60 * 1000);
		});
	});

	describe("computeSlaDueAt", () => {
		it("computes due date based on priority", () => {
			const created = new Date("2026-01-01T00:00:00Z");
			const due = computeSlaDueAt(created, "URGENT");
			expect(due).toEqual(new Date("2026-01-01T02:00:00Z"));
		});

		it("defaults to NORMAL duration for unknown priority", () => {
			const created = new Date("2026-01-01T00:00:00Z");
			const due = computeSlaDueAt(created, "UNKNOWN");
			expect(due).toEqual(new Date("2026-01-02T00:00:00Z"));
		});
	});

	describe("isSlaBreached", () => {
		it("returns false when slaDueAt is null", () => {
			expect(isSlaBreached({ slaDueAt: null, status: "OPEN" })).toBe(false);
		});

		it("returns false when ticket is CLOSED", () => {
			const past = new Date(Date.now() - 10000);
			expect(isSlaBreached({ slaDueAt: past, status: "CLOSED" })).toBe(false);
		});

		it("returns false when ticket is RESOLVED", () => {
			const past = new Date(Date.now() - 10000);
			expect(isSlaBreached({ slaDueAt: past, status: "RESOLVED" })).toBe(false);
		});

		it("returns true when due date is past and ticket is OPEN", () => {
			const past = new Date(Date.now() - 10000);
			expect(isSlaBreached({ slaDueAt: past, status: "OPEN" })).toBe(true);
		});

		it("returns false when due date is in the future", () => {
			const future = new Date(Date.now() + 10000);
			expect(isSlaBreached({ slaDueAt: future, status: "OPEN" })).toBe(false);
		});
	});

	describe("getSlaStatus", () => {
		it("returns 'none' when slaDueAt is null", () => {
			expect(getSlaStatus({ slaDueAt: null, status: "OPEN" })).toBe("none");
		});

		it("returns 'none' when ticket is CLOSED", () => {
			const past = new Date(Date.now() - 10000);
			expect(getSlaStatus({ slaDueAt: past, status: "CLOSED" })).toBe("none");
		});

		it("returns 'breached' when due date is past", () => {
			const past = new Date(Date.now() - 10000);
			expect(getSlaStatus({ slaDueAt: past, status: "IN_PROGRESS" })).toBe("breached");
		});

		it("returns 'warning' when less than 1 hour remains", () => {
			const soon = new Date(Date.now() + 30 * 60 * 1000); // 30 min
			expect(getSlaStatus({ slaDueAt: soon, status: "OPEN" })).toBe("warning");
		});

		it("returns 'ok' when more than 1 hour remains", () => {
			const later = new Date(Date.now() + 5 * 60 * 60 * 1000); // 5 hours
			expect(getSlaStatus({ slaDueAt: later, status: "OPEN" })).toBe("ok");
		});
	});

	describe("escalateBreachedTickets", () => {
		it("keeps an empty sweep out of production info logs", async () => {
			prismaMocks.findMany.mockResolvedValue([]);

			await expect(escalateBreachedTickets()).resolves.toBe(0);

			expect(loggerMocks.debug).toHaveBeenCalledWith("SLA escalation sweep complete", { breached: 0, escalated: 0 });
			expect(loggerMocks.info).not.toHaveBeenCalledWith("SLA escalation sweep complete", expect.anything());
		});

		it("marks URGENT breaches without re-notifying or writing no-op escalation rows", async () => {
			const dueAt = new Date("2026-01-01T00:00:00Z");
			prismaMocks.findMany.mockResolvedValue([
				{ id: "ticket-urgent", teamId: "team-1", status: "OPEN", priority: "URGENT", assigneeId: null, title: "Top", slaDueAt: dueAt, escalatedAt: null },
			]);
			txMocks.findManagers.mockResolvedValue([{ id: "mgr-1" }]);

			await expect(escalateBreachedTickets()).resolves.toBe(0);

			expect(txMocks.updateMany).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ escalatedAt: expect.any(Date) }),
				}),
			);
			// priority must not be rewritten as a fake change
			const data = txMocks.updateMany.mock.calls[0]![0]!.data as Record<string, unknown>;
			expect(data.priority).toBeUndefined();
			expect(txMocks.createEscalation).not.toHaveBeenCalled();
			expect(txMocks.createNotifications).not.toHaveBeenCalled();
		});

		it("processes the remaining tickets but rejects the sweep when one transaction fails", async () => {
			const dueAt = new Date("2026-01-01T00:00:00Z");
			prismaMocks.findMany.mockResolvedValue([
				{ id: "ticket-failed", teamId: "team-1", status: "OPEN", priority: "NORMAL", assigneeId: null, title: "Failed", slaDueAt: dueAt, escalatedAt: null },
				{ id: "ticket-ok", teamId: "team-1", status: "OPEN", priority: "NORMAL", assigneeId: null, title: "OK", slaDueAt: dueAt, escalatedAt: null },
			]);
			prismaMocks.transaction
				.mockRejectedValueOnce(new Error("database unavailable"))
				.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback({
					ticket: { updateMany: txMocks.updateMany },
					ticketEscalation: { create: txMocks.createEscalation },
					user: { findMany: txMocks.findManagers },
					notification: { createMany: txMocks.createNotifications },
				}));

			await expect(escalateBreachedTickets()).rejects.toThrow("Failed to escalate 1 of 2 ticket(s): ticket-failed");

			expect(prismaMocks.transaction).toHaveBeenCalledTimes(2);
			expect(txMocks.createEscalation).toHaveBeenCalledTimes(1);
			expect(loggerMocks.info).toHaveBeenCalledWith("Ticket SLA escalated", expect.objectContaining({ ticketId: "ticket-ok" }));
		});
	});
});
