import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the job-service internals, specifically `recordJobEventWithClient`.
 *
 * The transaction-awareness here fixes a real data-loss shape, spelled out in the
 * module comment: when the job row was created inside a transaction it is not yet
 * visible to other connections, so a fire-and-forget event write through the
 * global client violates `job_events_jobId_fkey` and the event is lost forever.
 * Inside a transaction the write must therefore use the *same* client and be
 * awaited before the callback returns, because the tx client is unusable
 * afterwards. Outside one, the write stays non-blocking so the hot enqueue path
 * is not slowed down.
 *
 * Both directions are asserted, plus the rule that a failure never propagates —
 * an audit-trail write must not fail the enqueue it is describing.
 */
const mocks = vi.hoisted(() => ({
	recordJobEvent: vi.fn(),
	prisma: {},
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("../events", () => ({ recordJobEvent: mocks.recordJobEvent }));

import { DEFAULT_LEASE_MS, futureFrom, recordJobEventWithClient, safeRecordJobEvent } from "../service-internals";

const input = { jobId: "job_1", type: "created" } as never;

describe("futureFrom", () => {
	it("offsets a date by the given milliseconds without mutating it", () => {
		const now = new Date("2026-08-31T12:00:00.000Z");
		expect(futureFrom(now, 60_000).toISOString()).toBe("2026-08-31T12:01:00.000Z");
		expect(now.toISOString()).toBe("2026-08-31T12:00:00.000Z");
	});

	it("accepts a zero or negative offset", () => {
		const now = new Date("2026-08-31T12:00:00.000Z");
		expect(futureFrom(now, 0).getTime()).toBe(now.getTime());
		expect(futureFrom(now, -1000).toISOString()).toBe("2026-08-31T11:59:59.000Z");
	});

	it("exposes a five-minute default lease", () => {
		// Workers heartbeat every 15s; the reaper reclaims a job whose lease expired.
		expect(DEFAULT_LEASE_MS).toBe(5 * 60 * 1000);
	});
});

describe("recordJobEventWithClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.recordJobEvent.mockReset();
		mocks.recordJobEvent.mockResolvedValue(undefined);
	});

	it("writes through the transaction client and awaits it when given one", async () => {
		// The tx client is unusable after the callback returns, so this write cannot
		// be fire-and-forget.
		const tx = { $kind: "tx" } as never;
		await recordJobEventWithClient(input, tx);
		expect(mocks.recordJobEvent).toHaveBeenCalledWith(input, tx);
	});

	it("does not block on the write when no client is supplied", async () => {
		let settle: (() => void) | undefined;
		mocks.recordJobEvent.mockImplementation(() => new Promise<void>((resolve) => { settle = resolve; }));
		// Resolves even though the underlying event write is still pending — the hot
		// enqueue path must not wait for the audit row.
		await recordJobEventWithClient(input, undefined as never);
		expect(mocks.recordJobEvent).toHaveBeenCalledWith(input);
		settle?.();
	});

	it("treats the global prisma client as 'not in a transaction'", async () => {
		// Passing the global client is the same as passing nothing: the row is
		// already visible, so the fast non-blocking path applies.
		await recordJobEventWithClient(input, mocks.prisma as never);
		expect(mocks.recordJobEvent).toHaveBeenCalledWith(input);
		expect(mocks.recordJobEvent.mock.calls[0]).toHaveLength(1);
	});

	it("swallows a failure inside a transaction so the enqueue still commits", async () => {
		mocks.recordJobEvent.mockRejectedValue(new Error("fk violation"));
		const tx = { $kind: "tx" } as never;
		await expect(recordJobEventWithClient(input, tx)).resolves.toBeUndefined();
	});

	it("swallows a failure on the non-transactional path too", async () => {
		mocks.recordJobEvent.mockRejectedValue(new Error("db down"));
		await expect(recordJobEventWithClient(input, undefined as never)).resolves.toBeUndefined();
		// Let the rejection settle so it does not surface as an unhandled rejection.
		await Promise.resolve();
	});
});

describe("safeRecordJobEvent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.recordJobEvent.mockReset();
	});

	it("returns synchronously without awaiting the write", () => {
		mocks.recordJobEvent.mockReturnValue(new Promise(() => {}));
		expect(safeRecordJobEvent(input)).toBeUndefined();
		expect(mocks.recordJobEvent).toHaveBeenCalledWith(input);
	});

	it("does not throw when the write rejects", async () => {
		mocks.recordJobEvent.mockRejectedValue(new Error("db down"));
		expect(() => safeRecordJobEvent(input)).not.toThrow();
		await Promise.resolve();
	});
});
