import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		createCommandRequest: vi.fn(),
		playbookRunUpdateMany: vi.fn(),
		commandRequestFindUnique: vi.fn(),
		recordJobEvent: vi.fn(),
		notificationCreate: vi.fn(),
		teamMemberFindUnique: vi.fn(),
		fetchWebhookSafely: vi.fn(),
	},
}));

vi.mock("@/lib/command/service", () => ({ createCommandRequest: mocks.createCommandRequest }));
vi.mock("@/lib/job/events", () => ({ recordJobEvent: mocks.recordJobEvent }));
vi.mock("@/lib/notification/service", () => ({ createNotification: mocks.notificationCreate }));
vi.mock("@/lib/db", () => ({
	prisma: {
		playbookRun: { updateMany: mocks.playbookRunUpdateMany },
		commandRequest: { findUnique: mocks.commandRequestFindUnique },
		commandTarget: { findMany: vi.fn(async () => [{ status: "FAILED", outcomeUnknown: false }]) },
		teamMember: { findUnique: mocks.teamMemberFindUnique },
	},
}));
vi.mock("@/lib/security/webhook-url", () => ({
	fetchWebhookSafely: mocks.fetchWebhookSafely,
	validateWebhookUrlSyntax: (url: string) => ({ ok: true as const, url }),
	assertWebhookUrlSafeForServerFetch: async (url: string) => ({ ok: true as const, url }),
}));

import { executePlaybookChain } from "../executor";
import type { PlaybookRecord } from "../types";

function buildPlaybook(steps: PlaybookRecord["steps"]): PlaybookRecord {
	return {
		id: "pb1",
		name: "Test",
		description: null,
		triggerType: "cron",
		triggerConfig: { expression: "0 3 * * *" },
		steps,
		chainRetry: 0,
		enabled: true,
		nextRunAt: null,
		lastTriggeredAt: null,
		createdById: null,
		ownerActive: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

describe("executePlaybookChain", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createCommandRequest.mockResolvedValue({ id: "request-1" });
		mocks.playbookRunUpdateMany.mockResolvedValue({ count: 1 });
		mocks.commandRequestFindUnique.mockResolvedValue({ status: "COMPLETED" });
		mocks.recordJobEvent.mockResolvedValue(undefined);
		mocks.notificationCreate.mockResolvedValue({ id: "n-1" });
		mocks.teamMemberFindUnique.mockResolvedValue(null);
	});

	it("returns dry_run results for every step without dispatching side effects", async () => {
		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "run",
				type: "run_command",
				config: { command: "echo hi", serverIds: ["srv1"] },
				retry: 0,
				timeoutSec: 60,
			},
			{
				id: "s2",
				name: "notify",
				type: "send_notification",
				config: { recipientUserId: "u1", subject: "s", body: "b" },
				retry: 0,
				timeoutSec: 60,
			},
		]);
		const { results: results, summary: _chainSummary } = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: true,
		});
		expect(results).toHaveLength(2);
		expect(results[0]?.status).toBe("dry_run");
		expect(results[1]?.status).toBe("dry_run");
		expect(mocks.createCommandRequest).not.toHaveBeenCalled();
		expect(mocks.notificationCreate).not.toHaveBeenCalled();
	});

	it("dispatches a run_command step and waits for its real command result", async () => {
		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "run",
				type: "run_command",
				config: { command: "ls -la", serverIds: ["srv1", "srv2"] },
				retry: 0,
				timeoutSec: 60,
			},
		]);
		const { results: results, summary: _chainSummary } = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: false,
			teamId: "team1",
		});
		expect(results[0]?.status).toBe("ok");
		expect(mocks.createCommandRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "ls -la",
				serverIds: ["srv1", "srv2"],
				teamId: "team1",
				idempotencyKey: "playbook:run-1:step:s1:a0",
			}),
		);
		expect(mocks.commandRequestFindUnique).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: "request-1" } }),
		);
	});

	it.each([
		{ count: 33, retry: 0, chainRetry: 0, error: /32 steps/ },
		{ count: 2, retry: 6, chainRetry: 0, error: /step retry/i },
		{ count: 2, retry: 0.5, chainRetry: 0, error: /step retry/i },
		{ count: 2, retry: 0, chainRetry: 6, error: /chainRetry/ },
	])("rejects a stored budget of $count steps, retry $retry, chainRetry $chainRetry before dispatch", async ({ count, retry, chainRetry, error }) => {
		const steps = Array.from({ length: count }, (_, index) => ({
			id: `s${index}`,
			name: "Notify",
			type: "send_notification" as const,
			config: { recipientUserId: "u1", subject: "s", body: "b" },
			retry: index === count - 1 ? retry : 0,
			timeoutSec: 60,
		}));
		const { results } = await executePlaybookChain({
			playbook: { id: "pb", steps, chainRetry }, runId: "run-budget", dryRun: false,
		});

		expect(results).toEqual([expect.objectContaining({ status: "failed", error: expect.stringMatching(error) })]);
		expect(mocks.notificationCreate).not.toHaveBeenCalled();
	});

	it("allows six attempts per round and six rounds at the valid retry limits", async () => {
		const playbook = buildPlaybook([{
			id: "s1", name: "cmd", type: "run_command", config: { command: "pwd", serverIds: ["srv1"] }, retry: 5, timeoutSec: 60,
		}]);
		mocks.createCommandRequest.mockRejectedValue(new Error("queue unavailable"));
		mocks.commandRequestFindUnique.mockResolvedValue(null);

		const { results } = await executePlaybookChain({
			playbook: { ...playbook, chainRetry: 5 }, runId: "run-boundary", dryRun: false,
		});

		expect(results[0]).toMatchObject({ status: "failed" });
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(36);
	});

	it("creates a Notification row for send_notification step without teamId", async () => {
		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "notify",
				type: "send_notification",
				config: { recipientUserId: "u1", subject: "hi", body: "world" },
				retry: 0,
				timeoutSec: 60,
			},
		]);
		const { results: results, summary: _chainSummary } = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: false,
		});
		expect(results[0]?.status).toBe("ok");
		expect(mocks.teamMemberFindUnique).not.toHaveBeenCalled();
		// Through the notification service: it stores the row and tells the
		// recipient's open pages (a bare insert showed no toast and no badge).
		expect(mocks.notificationCreate).toHaveBeenCalledWith({
			userId: "u1",
			type: "playbook",
			title: "hi",
			message: "world",
			teamId: null,
		});
	});

	it("checks team membership before send_notification when run has teamId", async () => {
		mocks.teamMemberFindUnique.mockResolvedValueOnce({ userId: "u1" });
		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "notify",
				type: "send_notification",
				config: { recipientUserId: "u1", subject: "hi", body: "world" },
				retry: 0,
				timeoutSec: 60,
			},
		]);
		const { results } = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: false,
			teamId: "team1",
		});
		expect(results[0]?.status).toBe("ok");
		expect(mocks.teamMemberFindUnique).toHaveBeenCalledWith({
			where: { teamId_userId: { teamId: "team1", userId: "u1" } },
			select: { userId: true },
		});
		expect(mocks.notificationCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", teamId: "team1" }));
	});

	it("fails send_notification when recipient is outside run team scope", async () => {
		mocks.teamMemberFindUnique.mockResolvedValueOnce(null);
		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "notify",
				type: "send_notification",
				config: { recipientUserId: "u-foreign", subject: "hi", body: "spam" },
				retry: 0,
				timeoutSec: 60,
			},
		]);
		const { results } = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: false,
			teamId: "team1",
		});
		expect(results[0]?.status).toBe("failed");
		expect(results[0]?.error).toMatch(/outside customer scope/i);
		expect(mocks.notificationCreate).not.toHaveBeenCalled();
	});

	it("calls the webhook URL via fetchWebhookSafely and records ok on 2xx", async () => {
		const url = "https://example.com/private-hook?token=sensitive";
		mocks.fetchWebhookSafely.mockResolvedValueOnce({
			ok: true,
			response: { ok: true, status: 200, statusText: "OK" },
		});
		const playbook = buildPlaybook([
			{
				id: "s1",
				name: url,
				type: "call_webhook",
				config: { url, method: "POST" },
				retry: 0,
				timeoutSec: 60,
			},
		]);
		const onProgress = vi.fn();
		const { results } = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: false,
			onProgress,
		});
		expect(results[0]?.status).toBe("ok");
		expect(results[0]?.summary).toBe("webhook step s1 POST example.com: HTTP 200");
		expect(JSON.stringify([results, onProgress.mock.calls, mocks.playbookRunUpdateMany.mock.calls])).not.toMatch(/private-hook|token=/);
		expect(mocks.fetchWebhookSafely).toHaveBeenCalledWith(
			url,
			expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
		);
	});

	it("fails a saved playbook whose steps share an id instead of skipping the second", async () => {
		// The second step was taken for done (same id) and never called; the
		// run still completed.
		mocks.fetchWebhookSafely.mockResolvedValue({ ok: true, response: { ok: true, status: 200, statusText: "OK" } });
		const hook = (url: string) => ({ id: "same", name: url, type: "call_webhook" as const, config: { url, method: "POST" as const }, retry: 0, timeoutSec: 60 });
		const { results } = await executePlaybookChain({
			playbook: buildPlaybook([hook("https://example.com/a"), hook("https://example.com/b")]),
			runId: "run-dup",
			dryRun: false,
		});
		expect(results.some((result) => result.status === "failed" && /more than one step/.test(result.error ?? ""))).toBe(true);
		expect(mocks.fetchWebhookSafely).not.toHaveBeenCalled();
		mocks.fetchWebhookSafely.mockReset();
	});

	it("spends the chain's failure retries on an ordinary step failure", async () => {
		// chainRetry only set the job's attempt limit, which a step failure
		// never reaches: an idempotent GET should retry a known HTTP failure.
		mocks.fetchWebhookSafely
			.mockResolvedValueOnce({ ok: true, response: { ok: false, status: 500, statusText: "Server Error" } })
			.mockResolvedValueOnce({ ok: true, response: { ok: true, status: 200, statusText: "OK" } });
		const playbook = { ...buildPlaybook([{ id: "s1", name: "hook", type: "call_webhook" as const, config: { url: "https://example.com/webhook", method: "GET" as const }, retry: 0, timeoutSec: 60 }]), chainRetry: 2 };
		const { results } = await executePlaybookChain({ playbook, runId: "run-chain", dryRun: false });
		expect(results[0]?.status).toBe("ok");
		expect(mocks.fetchWebhookSafely).toHaveBeenCalledTimes(2);
	});

	it("records only the status of a rejected POST and never repeats the non-idempotent request", async () => {
		mocks.fetchWebhookSafely.mockResolvedValueOnce({
			ok: true,
			response: { ok: false, status: 503, statusText: "private-hook?token=sensitive" },
		});
		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "hook",
				type: "call_webhook",
				config: { url: "https://example.com/private-hook?token=sensitive", method: "POST" },
				retry: 3,
				timeoutSec: 60,
			},
		]);
		const { results: results, summary: _chainSummary } = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: false,
		});
		expect(results[0]?.status).toBe("failed");
		expect(results[0]?.error).toBe("webhook step s1 POST example.com: HTTP 503");
		expect(results[0]?.sideEffectDispatched).toBe(true);
		expect(mocks.fetchWebhookSafely).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(mocks.playbookRunUpdateMany.mock.calls)).not.toMatch(/private-hook|token=/);
	});

	it("stops all retries after an unknown transport receipt, including on reclaim", async () => {
		const url = "https://example.com/private-hook?token=sensitive";
		const playbook = buildPlaybook([{ id: "h", name: url, type: "call_webhook", config: { url, method: "POST" }, retry: 3, timeoutSec: 60 }]);
		playbook.chainRetry = 2;
		mocks.fetchWebhookSafely.mockResolvedValue({ ok: false, dispatched: true, error: `error from ${url}` });
		const input = { playbook, runId: "unknown", dryRun: false };
		const { results } = await executePlaybookChain(input);
		expect(results[0]).toMatchObject({
			status: "failed", error: "webhook step h POST example.com: delivery outcome unknown",
			sideEffectDispatched: true, outcomeUnknown: true,
		});
		await executePlaybookChain({ ...input, resumeResults: results });
		expect(mocks.fetchWebhookSafely).toHaveBeenCalledTimes(1);
		expect(mocks.playbookRunUpdateMany.mock.calls.every(([update]) => update.data.stepResults[0]?.sideEffectDispatched)).toBe(true);
		expect(JSON.stringify(mocks.playbookRunUpdateMany.mock.calls)).not.toMatch(/private-hook|token=/);
	});

	it("can retry a POST refused before dispatch", async () => {
		mocks.fetchWebhookSafely
			.mockResolvedValueOnce({ ok: false, dispatched: false, error: "DNS failed" })
			.mockResolvedValueOnce({ ok: true, response: { ok: true, status: 204 } });
		const playbook = buildPlaybook([{ id: "h", name: "hook", type: "call_webhook", config: { url: "https://example.com/h", method: "POST" }, retry: 1, timeoutSec: 60 }]);
		const { results } = await executePlaybookChain({ playbook, runId: "retry", dryRun: false });
		expect(results[0]).toMatchObject({ status: "ok", httpStatus: 204 });
		expect(mocks.fetchWebhookSafely).toHaveBeenCalledTimes(2);
	});

	it("keeps infrastructure exceptions and invalid legacy methods out of webhook errors", async () => {
		const url = "https://example.com/private-hook?token=sensitive";
		const playbook = buildPlaybook([{ id: "h", name: url, type: "call_webhook", config: { url, method: url as "POST" }, retry: 0, timeoutSec: 60 }]);
		const beforeDispatch = vi.fn().mockRejectedValue(new Error(`could not claim ${url}`));
		const { results } = await executePlaybookChain({ playbook, runId: "before-send", dryRun: false, beforeDispatch });
		expect(results[0]?.error).toBe("webhook step h (invalid method) example.com: delivery failed");
		expect(JSON.stringify([results, mocks.playbookRunUpdateMany.mock.calls])).not.toMatch(/private-hook|token=/);
		expect(mocks.fetchWebhookSafely).not.toHaveBeenCalled();
	});

	it("redacts webhook URLs from dry runs and from old failed rows on reclaim", async () => {
		const url = "https://example.com/private-hook?token=sensitive";
		const playbook = buildPlaybook([{ id: "h", name: url, type: "call_webhook", config: { url, method: "POST" }, retry: 0, timeoutSec: 60 }]);
		const dry = await executePlaybookChain({ playbook, runId: "dry", dryRun: true });
		const resumedDry = await executePlaybookChain({
			playbook, runId: "dry", dryRun: true,
			resumeResults: [{ stepId: "h", status: "dry_run", summary: `dry-run: ${url}`, startedAt: "", completedAt: "" }],
		});
		const resumed = await executePlaybookChain({
			playbook, runId: "old", dryRun: false,
			resumeResults: [{ stepId: "h", status: "failed", summary: url, error: url, startedAt: "", completedAt: "", outcomeUnknown: true, sideEffectDispatched: true }],
		});
		expect(dry.results[0]?.summary).toBe("dry-run: webhook step h POST example.com");
		expect(resumedDry.results[0]).toMatchObject({ status: "dry_run", summary: dry.results[0]?.summary });
		expect(resumed.results[0]?.error).toBe("webhook step h POST example.com: delivery outcome unknown");
		expect(JSON.stringify([dry, resumedDry, resumed, mocks.playbookRunUpdateMany.mock.calls])).not.toMatch(/private-hook|token=/);
		expect(mocks.fetchWebhookSafely).not.toHaveBeenCalled();
	});

	it("aborts the chain on the first failed step in non-dryRun mode (no synthetic skipped entry)", async () => {
		mocks.createCommandRequest.mockRejectedValueOnce(new Error("queue down"));
		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "boom",
				type: "run_command",
				config: { command: "x", serverIds: ["srv1"] },
				retry: 0,
				timeoutSec: 60,
			},
			{
				id: "s2",
				name: "never",
				type: "send_notification",
				config: { recipientUserId: "u1", subject: "s", body: "b" },
				retry: 0,
				timeoutSec: 60,
			},
		]);
		const { results: results, summary: _chainSummary } = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: false,
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.status).toBe("failed");
		expect(mocks.notificationCreate).not.toHaveBeenCalled();
	});

	it("retries run_command with a fresh idempotency key after a terminal FAILED request", async () => {
		// First attempt: create request-1 which later ends FAILED.
		// Second attempt must NOT resume request-1 / key :a0 — must create request-2 with :a1.
		mocks.createCommandRequest
			.mockResolvedValueOnce({ id: "request-1" })
			.mockResolvedValueOnce({ id: "request-2" });
		mocks.commandRequestFindUnique
			// waitForCommand poll for request-1 → FAILED
			.mockResolvedValueOnce({ status: "FAILED" })
			// retry gate: the failed attempt's idempotency key, then request-1's state
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ status: "FAILED" })
			// resolveResumableCommandRequestId on attempt 1 should not see live running id
			// (cleared by onRetry); create request-2 then wait COMPLETED
			.mockResolvedValueOnce({ status: "COMPLETED" });

		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "run",
				type: "run_command",
				config: { command: "echo retry-me", serverIds: ["srv1"] },
				retry: 1,
				timeoutSec: 60,
			},
		]);
		const { results } = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: false,
			teamId: "team1",
		});
		expect(results[0]?.status).toBe("ok");
		expect(mocks.createCommandRequest).toHaveBeenCalledTimes(2);
		expect(mocks.createCommandRequest).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ idempotencyKey: "playbook:run-1:step:s1:a0" }),
		);
		expect(mocks.createCommandRequest).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ idempotencyKey: "playbook:run-1:step:s1:a1" }),
		);
		expect(results[0]?.commandRequestId).toBe("request-2");
	});

	it("does not resume a FAILED commandRequestId from resumeResults (reclaim after fail)", async () => {
		mocks.createCommandRequest.mockResolvedValueOnce({ id: "request-fresh" });
		// resolveResumableCommandRequestId sees FAILED on old id → discard
		mocks.commandRequestFindUnique
			.mockResolvedValueOnce({ status: "FAILED" })
			// waitForCommand for fresh request
			.mockResolvedValueOnce({ status: "COMPLETED" });

		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "run",
				type: "run_command",
				config: { command: "echo reclaim", serverIds: ["srv1"] },
				retry: 0,
				timeoutSec: 60,
			},
		]);
		const { results } = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: false,
			resumeResults: [
				{
					stepId: "s1",
					status: "running",
					startedAt: new Date().toISOString(),
					completedAt: "",
					summary: "command request request-old dispatched",
					commandRequestId: "request-old",
				},
			],
		});
		expect(results[0]?.status).toBe("ok");
		expect(mocks.createCommandRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				idempotencyKey: "playbook:run-1:step:s1:a0",
			}),
		);
		expect(results[0]?.commandRequestId).toBe("request-fresh");
	});

	it("does not re-call a dispatched webhook on reclaim even when the step allows retries", async () => {
		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "hook",
				type: "call_webhook",
				// retry > 0 used to defeat the at-most-once guard: the guard threw,
				// the retry loop dropped the marker row and the next attempt called
				// the webhook anyway.
				retry: 3,
				timeoutSec: 60,
				config: { url: "https://example.com/webhook", method: "POST" },
			},
		]);
		const { results } = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: false,
			resumeResults: [
				{
					stepId: "s1",
					status: "running",
					startedAt: new Date().toISOString(),
					completedAt: "",
					summary: "side effect dispatched",
					sideEffectDispatched: true,
				},
			],
		});
		expect(results[0]?.status).toBe("failed");
		expect(results[0]?.error).toContain("at-most-once");
		expect(mocks.fetchWebhookSafely).not.toHaveBeenCalled();
	});

	it("keeps the dispatched marker on a failed step so a later reclaim cannot re-send", async () => {
		mocks.notificationCreate.mockRejectedValueOnce(new Error("db down"));
		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "notify",
				type: "send_notification",
				retry: 0,
				timeoutSec: 60,
				config: { recipientUserId: "u1", subject: "s", body: "b" },
			},
		]);
		const first = await executePlaybookChain({ playbook, runId: "run-1", dryRun: false });
		expect(first.results[0]?.status).toBe("failed");
		expect(first.results[0]?.sideEffectDispatched).toBe(true);

		// Reclaiming that run must not create a second Notification row.
		mocks.notificationCreate.mockClear();
		const second = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: false,
			resumeResults: first.results,
		});
		expect(second.results[0]?.status).toBe("failed");
		expect(mocks.notificationCreate).not.toHaveBeenCalled();
	});
});
