// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { exportFileSchema, type ExportFile } from "../config-schema";
import { importPlaybooks } from "../import-executors-automation";
import type { Tx } from "../import-executors-helpers";
import { previewPlaybooks } from "../import-preview-tables";

const playbook = vi.hoisted(() => ({
  findMany: vi.fn().mockResolvedValue([]),
  createMany: vi.fn().mockResolvedValue({ count: 1 }),
}));
vi.mock("@/lib/db", () => ({ prisma: { playbook } }));

const tx = { playbook } as unknown as Tx;
const options = { dryRun: false, overwriteExisting: true, importUsers: true, importSettings: true };
const step = {
  id: "notify", name: "Notify", type: "send_notification",
  config: { recipientUserId: "operator", subject: "Status", body: "Done" },
};
const row = {
  id: "pb", name: "Schedule", description: null, triggerType: "cron", triggerConfig: { expression: "0 1 * * *" },
  steps: [step], chainRetry: 0, enabled: true, createdById: null, createdAt: "2026-01-01T00:00:00.000Z",
};
const steps = (count: number, retry: number) => Array.from({ length: count }, (_, i) => ({ ...step, id: `step-${i}`, retry }));

describe("Playbook import validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["more than 32 steps", { steps: steps(33, 0) }],
    ["step retry above five", { steps: steps(1, 6) }],
    ["negative step retry", { steps: steps(1, -1) }],
    ["fractional step retry", { steps: steps(1, 1.5) }],
    ["chain retry above five", { chainRetry: 6 }],
    ["negative chain retry", { chainRetry: -1 }],
    ["fractional chain retry", { chainRetry: 1.5 }],
    ["malformed step configuration", { steps: [{ ...step, config: {} }] }],
    ["duplicate step IDs", { steps: [step, step] }],
  ])("rejects %s before counting or writing any rows", async (_reason, invalid) => {
    const playbooks = [row, { ...row, ...invalid, id: "invalid" }];
    const tables = { playbooks } as ExportFile["tables"];
    expect(exportFileSchema.shape.tables.shape.playbooks.safeParse(playbooks).success).toBe(false);
    await expect(previewPlaybooks(tables, { ...options, dryRun: true })).rejects.toThrow(ZodError);
    await expect(importPlaybooks(tx, tables, options, { created: 0, updated: 0, skipped: 0 })).rejects.toThrow(ZodError);
    expect(playbook.findMany).not.toHaveBeenCalled();
    expect(playbook.createMany).not.toHaveBeenCalled();
  });

  it("imports 32 steps with five retries and writes the parsed defaults", async () => {
    const maxSteps = steps(32, 5);
    const untrimmed = maxSteps.map((s) => ({ ...s, config: { ...s.config, subject: " Status " } }));
    const tables = { playbooks: [{ ...row, steps: untrimmed, chainRetry: 5 }] } as ExportFile["tables"];
    expect(await previewPlaybooks(tables, { ...options, dryRun: true })).toEqual({ create: 1, update: 0, skip: 0 });
    const counts = { created: 0, updated: 0, skipped: 0 };
    await importPlaybooks(tx, tables, options, counts);
    expect(counts).toEqual({ created: 1, updated: 0, skipped: 0 });
    expect(playbook.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ steps: maxSteps.map((s) => ({ ...s, timeoutSec: 60 })), chainRetry: 5 })],
      skipDuplicates: true,
    });
  });
});
