import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A timed-out command step is cancelled before the step retries. Cancelling a
 * RUNNING request only moves it to CANCELLING: the target may still be
 * executing until the executor acknowledges. The retry must not create a
 * second CommandRequest (a concurrent re-run of a possibly destructive command)
 * until the first one is terminal, and must stop retrying if that never
 * happens.
 */
const { mocks, statuses, keys, targets, timeoutCancellations, faults } = vi.hoisted(() => ({
	statuses: new Map<string, string>(),
	keys: new Map<string, string>(),
	targets: new Map<string, string[]>(),
	timeoutCancellations: new Set<string>(),
	/** Transient database failures, consumed one per call. */
	faults: { targetReads: 0, findUnique: [] as number[], findUniqueCalls: 0, updateMany: 0 },
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
		playbookRun: {
			updateMany: vi.fn(async (...args: unknown[]) => {
				if (faults.updateMany > 0) {
					faults.updateMany -= 1;
					throw new Error("progress write failed (injected)");
				}
				return mocks.playbookRunUpdateMany(...(args as []));
			}),
		},
		commandTarget: {
			findMany: vi.fn(async ({ where }: { where: { commandRequestId: string } }) => {
				if (faults.targetReads > 0) {
					faults.targetReads -= 1;
					throw new Error("target read failed (injected)");
				}
				const id = where.commandRequestId;
				return (targets.get(id) ?? [statuses.get(id)]).map((status) => ({
					status, outcomeUnknown: statuses.has(`unknown:${id}`),
				}));
			}),
		},
		executionLog: {
			findFirst: vi.fn(async ({ where }: { where: { commandRequestId: string; serverId: string | null; summary: { startsWith: string } } }) => {
				const matches = where.serverId === null && where.summary.startsWith === "Command cancellation requested by system:playbook-timeout;";
				return matches && timeoutCancellations.has(where.commandRequestId) ? { id: "timeout-log" } : null;
			}),
		},
		commandRequest: {
			findUnique: vi.fn(async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
				faults.findUniqueCalls += 1;
				if (faults.findUnique.includes(faults.findUniqueCalls)) throw new Error("read failed (injected)");
				const id = where.idempotencyKey ? keys.get(where.idempotencyKey) : where.id;
				const status = id ? statuses.get(id) : undefined;
				return status ? { id, status } : null;
			}),
		},
	},
}));

import { executePlaybookChain } from "../executor";
import type { PlaybookRecord } from "../types";

function playbookWithRetry(serverIds = ["srv1"]): Pick<PlaybookRecord, "id" | "steps"> {
	return {
		id: "pb1",
		steps: [
			{
				id: "s1",
				name: "restart",
				type: "run_command",
				config: { command: "systemctl restart app", serverIds },
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
	keys.clear();
	targets.clear();
	timeoutCancellations.clear();
	Object.assign(faults, { targetReads: 0, findUnique: [], findUniqueCalls: 0, updateMany: 0 });
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

async function run(serverIds?: string[]) {
	const pending = executePlaybookChain({ playbook: playbookWithRetry(serverIds), runId: "run-1", dryRun: false });
	await vi.runAllTimersAsync();
	return pending;
}

describe("playbook command timeout → cancel → retry barrier", () => {
	it.each(["FAILED", "CANCELLED"])("never replays a %s batch that completed on one server", async (status) => {
		mocks.createCommandRequest.mockImplementation(async () => {
			statuses.set("batch", status);
			targets.set("batch", ["COMPLETED", status]);
			timeoutCancellations.add("batch");
			return { id: "batch" };
		});
		const { results } = await run(["srv1", "srv2"]);
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
		expect(results[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/already completed on a target/) });
	});

	it.each(["CANCELLED", "REJECTED"])("honours an operator's %s before the step timeout", async (status) => {
		mocks.createCommandRequest.mockImplementation(async () => {
			statuses.set("stopped", status);
			return { id: "stopped" };
		});
		const { results } = await run();
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
		expect(mocks.cancelCommandRequest).not.toHaveBeenCalled();
		expect(results[0]).toMatchObject({ status: "failed", commandRequestId: "stopped" });
	});

	it("honours an operator's cancellation that wins the race with the timeout", async () => {
		mocks.cancelCommandRequest.mockImplementation(async ({ commandRequestId }: { commandRequestId: string }) => {
			// Already CANCELLING on entry: cancelCommandRequest returns normally
			// without claiming the cancellation or writing a timeout log.
			statuses.set(commandRequestId, "CANCELLED");
		});
		const { results } = await run();
		expect(mocks.cancelCommandRequest).toHaveBeenCalledTimes(1);
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
		expect(results[0]?.error).toMatch(/cancelled; not retrying/);
	});

	it.each([
		["FAILED", ["FAILED", "COMPLETED"]],
		["CANCELLED", ["CANCELLED", "CANCELLED"]],
		["REJECTED", ["REJECTED", "REJECTED"]],
	] as const)("checks the targets and cancellation source before discarding a reclaimed %s request", async (status, targetStatuses) => {
		statuses.set("previous", status);
		targets.set("previous", [...targetStatuses]);
		const { results } = await executePlaybookChain({
			playbook: playbookWithRetry(["srv1", "srv2"]), runId: "run-1", dryRun: false,
			resumeResults: [{ stepId: "s1", status: "running", startedAt: "", completedAt: "", summary: "", commandRequestId: "previous" }],
		});
		expect(mocks.createCommandRequest).not.toHaveBeenCalled();
		expect(results[0]).toMatchObject({ status: "failed", commandRequestId: "previous" });
	});

	it("checks individual targets when a failed create is recovered by its idempotency key", async () => {
		mocks.createCommandRequest.mockImplementationOnce(async (input: { idempotencyKey: string }) => {
			keys.set(input.idempotencyKey, "batch");
			statuses.set("batch", "FAILED");
			targets.set("batch", ["COMPLETED", "FAILED"]);
			throw new Error("database response lost");
		});
		const { results } = await run(["srv1", "srv2"]);
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
		expect(results[0]?.error).toMatch(/already completed on a target/);
	});

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
			timeoutCancellations.add(commandRequestId);
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

	it("does not retry a failed command whose target could not confirm the remote process stopped", async () => {
		mocks.createCommandRequest.mockImplementation(async () => {
			created += 1;
			const id = `request-${created}`;
			statuses.set(id, "FAILED");
			statuses.set(`unknown:${id}`, "1");
			return { id };
		});
		const { results } = await run();
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
		expect(results[0]).toMatchObject({ status: "failed", commandRequestId: "request-1" });
		expect(results[0]?.error).toMatch(/could not confirm the remote process stopped/);
	});

	it("does not retry when the timed-out command's cancellation ends FAILED with an unconfirmed target", async () => {
		// timeout → cancel → CANCELLING for a while → the executor gives up on an
		// Agent that never acknowledged: FAILED + outcomeUnknown.
		mocks.cancelCommandRequest.mockImplementation(async ({ commandRequestId }: { commandRequestId: string }) => {
			statuses.set(commandRequestId, "CANCELLING");
			setTimeout(() => {
				statuses.set(commandRequestId, "FAILED");
				statuses.set(`unknown:${commandRequestId}`, "1");
			}, 35_000);
		});
		const { results } = await run();
		expect(mocks.cancelCommandRequest).toHaveBeenCalledTimes(1);
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
		expect(results[0]).toMatchObject({ status: "failed", commandRequestId: "request-1" });
		expect(results[0]?.error).toMatch(/could not confirm the remote process stopped/);
	});

	it("does not retry when the cancellation ends CANCELLED with an unconfirmed target either", async () => {
		mocks.cancelCommandRequest.mockImplementation(async ({ commandRequestId }: { commandRequestId: string }) => {
			statuses.set(commandRequestId, "CANCELLED");
			statuses.set(`unknown:${commandRequestId}`, "1");
		});
		const { results } = await run();
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
		expect(results[0]?.error).toMatch(/could not confirm the remote process stopped/);
	});

	it("a reclaimed run never starts a new attempt after a previous request ended with an unknown outcome", async () => {
		statuses.set("request-prev", "FAILED");
		statuses.set("unknown:request-prev", "1");
		const pending = executePlaybookChain({
			playbook: playbookWithRetry(),
			runId: "run-1",
			dryRun: false,
			resumeResults: [{ stepId: "s1", status: "running", startedAt: new Date().toISOString(), completedAt: "", summary: "", commandRequestId: "request-prev" }],
		});
		await vi.runAllTimersAsync();
		const { results } = await pending;
		expect(mocks.createCommandRequest).not.toHaveBeenCalled();
		expect(results[0]).toMatchObject({ status: "failed" });
		expect(results[0]?.error).toMatch(/could not confirm the remote process stopped/);
	});

	describe("a transient database failure never lets a possibly running command be started twice", () => {
		it("a target read fails once: the next check still finds the unconfirmed target", async () => {
			mocks.createCommandRequest.mockImplementation(async () => {
				created += 1;
				const id = `request-${created}`;
				statuses.set(id, "FAILED");
				statuses.set(`unknown:${id}`, "1");
				return { id };
			});
			faults.targetReads = 1;
			const { results } = await run();
			expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
			expect(results[0]).toMatchObject({ status: "failed", commandRequestId: "request-1" });
			expect(results[0]?.error).toMatch(/could not confirm the remote process stopped/);
		});

		it("a status read fails while the command is still running: no retry", async () => {
			faults.findUnique = [1];
			const { results } = await run();
			expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
			expect(results[0]).toMatchObject({ status: "failed", commandRequestId: "request-1" });
			expect(results[0]?.error).toMatch(/is RUNNING; not retrying/);
		});

		it("the progress write fails right after the command was created: no retry", async () => {
			faults.updateMany = 1;
			const { results } = await run();
			expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
			expect(results[0]?.error).toMatch(/not retrying while it may still be running/);
		});

		it("the create call throws after the command row exists: found by its key, no retry", async () => {
			mocks.createCommandRequest.mockImplementationOnce(async (request: { idempotencyKey: string }) => {
				created += 1;
				statuses.set("request-1", "RUNNING");
				keys.set(request.idempotencyKey, "request-1");
				throw new Error("enqueue failed after insert (injected)");
			});
			const { results } = await run();
			expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
			expect(results[0]?.error).toMatch(/request-1 is RUNNING; not retrying/);
		});

		it("the retry gate cannot read the command state: no retry", async () => {
			mocks.createCommandRequest.mockImplementation(async () => {
				created += 1;
				const id = `request-${created}`;
				statuses.set(id, "FAILED");
				return { id };
			});
			// 1: wait sees FAILED; 2: key lookup; 3: gate status read fails.
			faults.findUnique = [3];
			const { results } = await run();
			expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
			expect(results[0]?.error).toMatch(/could not be read/);
		});

		it("a command that completed before the step failed is not run again", async () => {
			mocks.createCommandRequest.mockImplementation(async () => {
				created += 1;
				const id = `request-${created}`;
				statuses.set(id, "COMPLETED");
				return { id };
			});
			// The wait's status read fails once although the command has completed.
			faults.findUnique = [1];
			const { results } = await run();
			expect(mocks.createCommandRequest).toHaveBeenCalledTimes(1);
			expect(results[0]?.error).toMatch(/completed; not running the command again/);
		});
	});

	it("still retries an ordinary failure", async () => {
		mocks.createCommandRequest.mockImplementation(async () => {
			created += 1;
			const id = `request-${created}`;
			statuses.set(id, created < 3 ? "FAILED" : "COMPLETED");
			return { id };
		});
		const { results } = await run();
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(3);
		expect(results[0]).toMatchObject({ status: "ok", commandRequestId: "request-3" });
	});
});
