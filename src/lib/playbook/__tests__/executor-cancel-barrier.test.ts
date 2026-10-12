import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A timed-out command step is cancelled before the step retries. Cancelling a
 * RUNNING request only moves it to CANCELLING: the target may still be
 * executing until the executor acknowledges. The retry must not create a
 * second CommandRequest (a concurrent re-run of a possibly destructive command)
 * until the first one is terminal, and must stop retrying if that never
 * happens.
 */
const { mocks, statuses } = vi.hoisted(() => ({
	statuses: new Map<string, string>(),
	mocks: {
		createCommandRequest: vi.fn(),
		cancelCommandRequest: vi.fn(),
		playbookRunUpdateMany: vi.fn(async () => ({ count: 1 })),
		recordJobEvent: vi.fn(async () => undefined),
	},
}));

vi.mock("@/lib/command/service", () => ({
	createCommandRequest: mocks.createCommandRequest,
	cancelCommandRequest: mocks.cancelCommandRequest,
}));
vi.mock("@/lib/job/events", () => ({ recordJobEvent: mocks.recordJobEvent }));
vi.mock("@/lib/security/webhook-url", () => ({ fetchWebhookSafely: vi.fn() }));
vi.mock("@/lib/db", () => ({
	prisma: {
		playbookRun: { updateMany: mocks.playbookRunUpdateMany },
		commandRequest: {
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
				const status = statuses.get(where.id);
				return status ? { status } : null;
			}),
		},
	},
}));

import { executePlaybookChain } from "../executor";
import type { PlaybookRecord } from "../types";

function playbookWithRetry(): Pick<PlaybookRecord, "id" | "steps"> {
	return {
		id: "pb1",
		steps: [
			{
				id: "s1",
				name: "restart",
				type: "run_command",
				config: { command: "systemctl restart app", serverIds: ["srv1"] },
				retry: 2,
				timeoutSec: 5,
			},
		],
	};
}

let created = 0;

beforeEach(() => {
	vi.useFakeTimers();
	statuses.clear();
	created = 0;
	mocks.createCommandRequest.mockReset().mockImplementation(async () => {
		created += 1;
		const id = `request-${created}`;
		statuses.set(id, "RUNNING");
		return { id };
	});
	mocks.cancelCommandRequest.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

async function run() {
	const pending = executePlaybookChain({ playbook: playbookWithRetry(), runId: "run-1", dryRun: false });
	await vi.runAllTimersAsync();
	return pending;
}

describe("playbook command timeout → cancel → retry barrier", () => {
	it("never creates the next attempt while the timed-out command is still CANCELLING", async () => {
		mocks.cancelCommandRequest.mockImplementation(async ({ commandRequestId }: { commandRequestId: string }) => {
			statuses.set(commandRequestId, "CANCELLING"); // executor never acknowledges
		});
		const { results } = await run();
		expect(mocks.cancelCommandRequest).toHaveBeenCalledTimes(1);
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
		expect(results[0]).toMatchObject({ status: "failed", commandRequestId: "request-1" });
		expect(results[0]?.error).toMatch(/cancellation was not confirmed/);
	});

	it("retries once the cancellation is confirmed terminal", async () => {
		mocks.cancelCommandRequest.mockImplementation(async ({ commandRequestId }: { commandRequestId: string }) => {
			statuses.set(commandRequestId, "CANCELLING");
			// The executor acknowledges a little later.
			setTimeout(() => statuses.set(commandRequestId, "CANCELLED"), 3_000);
		});
		mocks.createCommandRequest.mockImplementationOnce(async () => {
			created += 1;
			statuses.set("request-1", "RUNNING");
			return { id: "request-1" };
		}).mockImplementationOnce(async () => {
			created += 1;
			statuses.set("request-2", "COMPLETED");
			return { id: "request-2" };
		});
		const { results } = await run();
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(2);
		expect(statuses.get("request-1")).toBe("CANCELLED");
		expect(results[0]).toMatchObject({ status: "ok", commandRequestId: "request-2" });
	});

	it("treats a command that completed while being cancelled as a success, not a retry", async () => {
		mocks.cancelCommandRequest.mockImplementation(async ({ commandRequestId }: { commandRequestId: string }) => {
			statuses.set(commandRequestId, "COMPLETED");
		});
		const { results } = await run();
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
		expect(results[0]).toMatchObject({ status: "ok", commandRequestId: "request-1" });
	});
});
