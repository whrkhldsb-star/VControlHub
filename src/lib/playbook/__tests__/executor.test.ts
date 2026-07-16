import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		createCommandRequest: vi.fn(),
		playbookRunUpdateMany: vi.fn(),
		commandRequestFindUnique: vi.fn(),
		recordJobEvent: vi.fn(),
		notificationCreate: vi.fn(),
		fetchWebhookSafely: vi.fn(),
	},
}));

vi.mock("@/lib/command/service", () => ({ createCommandRequest: mocks.createCommandRequest }));
vi.mock("@/lib/job/events", () => ({ recordJobEvent: mocks.recordJobEvent }));
vi.mock("@/lib/db", () => ({
	prisma: {
		notification: { create: mocks.notificationCreate },
		playbookRun: { updateMany: mocks.playbookRunUpdateMany },
		commandRequest: { findUnique: mocks.commandRequestFindUnique },
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
		createdById: null,
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

	it("creates a Notification row for send_notification step", async () => {
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
		expect(mocks.notificationCreate).toHaveBeenCalledWith({
			data: {
				userId: "u1",
				type: "playbook",
				title: "hi",
				message: "world",
				teamId: null,
			},
		});
	});

	it("calls the webhook URL via fetchWebhookSafely and records ok on 2xx", async () => {
		mocks.fetchWebhookSafely.mockResolvedValueOnce({
			ok: true,
			response: { ok: true, status: 200, statusText: "OK" },
		});
		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "hook",
				type: "call_webhook",
				config: { url: "https://example.com/webhook", method: "POST" },
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
		expect(results[0]?.summary).toContain("200");
		expect(mocks.fetchWebhookSafely).toHaveBeenCalledWith(
			"https://example.com/webhook",
			expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
		);
	});

	it("fails the webhook step on non-2xx response (no silent success)", async () => {
		mocks.fetchWebhookSafely.mockResolvedValueOnce({
			ok: true,
			response: { ok: false, status: 503, statusText: "Service Unavailable" },
		});
		const playbook = buildPlaybook([
			{
				id: "s1",
				name: "hook",
				type: "call_webhook",
				config: { url: "https://example.com/broken", method: "POST" },
				retry: 0,
				timeoutSec: 60,
			},
		]);
		const { results: results, summary: _chainSummary } = await executePlaybookChain({
			playbook,
			runId: "run-1",
			dryRun: false,
		});
		expect(results[0]?.status).toBe("failed");
		expect(results[0]?.error).toContain("503");
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
});
