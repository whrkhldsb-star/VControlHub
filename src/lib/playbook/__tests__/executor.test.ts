import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		enqueueJob: vi.fn(),
		recordJobEvent: vi.fn(),
		notificationCreate: vi.fn(),
		fetchWebhookSafely: vi.fn(),
	},
}));

vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/job/events", () => ({ recordJobEvent: mocks.recordJobEvent }));
vi.mock("@/lib/db", () => ({
	prisma: {
		notification: { create: mocks.notificationCreate },
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
		mocks.enqueueJob.mockResolvedValue({ id: "job-1" });
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
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
		expect(mocks.notificationCreate).not.toHaveBeenCalled();
	});

	it("dispatches a run_command step via enqueueJob", async () => {
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
		});
		expect(results[0]?.status).toBe("ok");
		expect(mocks.enqueueJob).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "playbook.command",
				payload: expect.objectContaining({ command: "ls -la", serverIds: ["srv1", "srv2"] }),
			}),
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
		mocks.enqueueJob.mockRejectedValueOnce(new Error("queue down"));
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
});
