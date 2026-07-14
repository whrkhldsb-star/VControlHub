import { describe, it, expect } from "vitest";
import { computeSlaDueAt, isSlaBreached, getSlaStatus, SLA_DURATIONS_MS } from "../sla";

describe("ticket SLA service", () => {
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
});
