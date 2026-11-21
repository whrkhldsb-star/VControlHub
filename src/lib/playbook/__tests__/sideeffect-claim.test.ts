import { beforeEach, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/errors";

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
vi.mock("@/lib/notification/service", () => ({ createNotification: mocks.notificationCreate }));
vi.mock("@/lib/job/events", () => ({ recordJobEvent: mocks.recordJobEvent }));
vi.mock("@/lib/db", () => ({
  prisma: {
    playbookRun: { updateMany: mocks.playbookRunUpdateMany },
    commandRequest: { findUnique: mocks.commandRequestFindUnique },
    teamMember: { findUnique: mocks.teamMemberFindUnique },
  },
}));
vi.mock("../webhook-dispatch", () => ({ fetchPlaybookWebhook: mocks.fetchWebhookSafely }));
vi.mock("@/lib/security/webhook-url", () => ({
  fetchWebhookSafely: mocks.fetchWebhookSafely,
  validateWebhookUrlSyntax: (url: string) => ({ ok: true as const, url }),
  assertWebhookUrlSafeForServerFetch: async (url: string) => ({ ok: true as const, url }),
}));

import { executePlaybookChain } from "../executor";
import type { PlaybookRecord } from "../types";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.playbookRunUpdateMany.mockResolvedValue({ count: 1 });
  mocks.recordJobEvent.mockResolvedValue(undefined);
});

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

const effects: PlaybookRecord["steps"] = [
  { id: "cmd", type: "run_command", name: "cmd", config: { command: "pwd", serverIds: ["server"] }, timeoutSec: 30, retry: 2 },
  { id: "msg", type: "send_notification", name: "msg", config: { recipientUserId: "u", subject: "subject", body: "body" }, timeoutSec: 30, retry: 2 },
  { id: "hook", type: "call_webhook", name: "hook", config: { url: "https://example.invalid/test", method: "POST" }, timeoutSec: 30, retry: 2 },
];

it.each(effects)("checks authorization immediately before $type and stops on revocation", async (step) => {
  const beforeDispatch = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new ForbiddenError());
  const { results } = await executePlaybookChain({
    playbook: buildPlaybook([step]), runId: "demoted", requesterId: "u", teamId: null, dryRun: false, beforeDispatch,
  });
  expect(results[0]?.status).toBe("failed");
  expect(beforeDispatch).toHaveBeenCalledTimes(2);
  expect(mocks.createCommandRequest).not.toHaveBeenCalled();
  expect(mocks.notificationCreate).not.toHaveBeenCalled();
  expect(mocks.fetchWebhookSafely).not.toHaveBeenCalled();
});

it("propagates lost lease without persisting progress or dispatching later steps", async () => {
  const { LeaseLostError } = await import("@/lib/job/heartbeat-runner");
  const lost = new LeaseLostError("job");
  const beforeDispatch = vi.fn().mockRejectedValue(lost);
  await expect(executePlaybookChain({
    playbook: buildPlaybook([{ id: "hook", type: "call_webhook", name: "hook", config: { url: "https://example.invalid/test", method: "POST" }, timeoutSec: 30, retry: 2 }]),
    runId: "lost", requesterId: "u", teamId: "team", dryRun: false, beforeDispatch,
  })).rejects.toBe(lost);
  expect(beforeDispatch).toHaveBeenCalledTimes(1);
  expect(mocks.playbookRunUpdateMany).not.toHaveBeenCalled();
  expect(mocks.fetchWebhookSafely).not.toHaveBeenCalled();
});

it("aborts an in-flight webhook with the worker lease signal", async () => {
  const controller = new AbortController();
  const lost = new Error("lease lost");
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  mocks.fetchWebhookSafely.mockImplementation(async (_url: string, init: RequestInit) => {
    entered();
    return new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
  });
  const task = executePlaybookChain({ playbook: buildPlaybook([{ id: "hook", type: "call_webhook", name: "hook", config: { url: "https://example.invalid/test", method: "POST" }, timeoutSec: 30, retry: 0 }]), runId: "r", requesterId: "u", dryRun: false, signal: controller.signal });
  const outcome = expect(task).rejects.toBe(lost);
  await started;
  controller.abort(lost);
  await outcome;
  expect(mocks.fetchWebhookSafely).toHaveBeenCalledTimes(1);
});

it("refuses to dispatch a webhook when the durable running marker CAS is lost", async () => {
  mocks.playbookRunUpdateMany.mockResolvedValue({ count: 0 });
  mocks.fetchWebhookSafely.mockResolvedValue({ ok: true, response: new Response("ok") });
  mocks.recordJobEvent.mockResolvedValue(undefined);
  await expect(executePlaybookChain({ playbook: buildPlaybook([{ id: "hook", type: "call_webhook", name: "hook", config: { url: "https://example.invalid/test", method: "POST" }, timeoutSec: 30, retry: 0 }]), runId: "already-failed", requesterId: "u", teamId: "team", dryRun: false })).rejects.toThrow();
  expect(mocks.fetchWebhookSafely).not.toHaveBeenCalled();
});
