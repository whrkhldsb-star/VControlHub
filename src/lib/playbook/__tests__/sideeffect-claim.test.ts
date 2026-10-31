import { beforeEach, expect, it, vi } from "vitest";

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
vi.mock("@/lib/db", () => ({
  prisma: {
    notification: { create: mocks.notificationCreate },
    playbookRun: { updateMany: mocks.playbookRunUpdateMany },
    commandRequest: { findUnique: mocks.commandRequestFindUnique },
    commandTarget: { count: vi.fn(async () => 0) },
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}


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
