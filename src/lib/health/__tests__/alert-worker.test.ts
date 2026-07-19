import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobFindFirst: vi.fn(),
  enqueueJob: vi.fn(),
  claimNextJob: vi.fn(),
  heartbeatJob: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  pruneCompletedJobsByType: vi.fn(),
  evaluateAlerts: vi.fn(),
  ensureDefaultAlertRules: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    job: { findFirst: mocks.jobFindFirst },
  },
}));

vi.mock("@/lib/job/service", () => ({
  enqueueJob: mocks.enqueueJob,
  claimNextJob: mocks.claimNextJob,
  heartbeatJob: mocks.heartbeatJob,
  completeJob: mocks.completeJob,
  failJob: mocks.failJob,
  pruneCompletedJobsByType: mocks.pruneCompletedJobsByType,
}));

vi.mock("@/lib/health/service", () => ({
  evaluateAlerts: mocks.evaluateAlerts,
}));

vi.mock("@/lib/alert/service", () => ({
  ensureDefaultAlertRules: mocks.ensureDefaultAlertRules,
}));

vi.mock("@/lib/config/env", () => ({
  config: { app: { hostname: "test-host" } },
}));

vi.mock("@/lib/job/lease", () => ({
  computeLeaseMs: () => 60_000,
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { runAlertEvaluationJobWorkerOnce } from "../alert-worker";

describe("alert evaluation worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jobFindFirst.mockResolvedValue(null);
    mocks.enqueueJob.mockResolvedValue({ id: "job_enq" });
    mocks.claimNextJob.mockResolvedValue({ id: "job1" });
    mocks.heartbeatJob.mockResolvedValue(undefined);
    mocks.completeJob.mockResolvedValue(undefined);
    mocks.failJob.mockResolvedValue(undefined);
    mocks.pruneCompletedJobsByType.mockResolvedValue({ count: 0 });
    mocks.evaluateAlerts.mockResolvedValue({ fired: 0 });
    mocks.ensureDefaultAlertRules.mockResolvedValue({ created: 0, skipped: true });
  });

  it("ensures default rules before evaluating", async () => {
    expect(await runAlertEvaluationJobWorkerOnce("test")).toBe(true);
    expect(mocks.ensureDefaultAlertRules).toHaveBeenCalledWith(null);
    expect(mocks.evaluateAlerts).toHaveBeenCalledTimes(1);
    expect(mocks.completeJob).toHaveBeenCalledWith(
      "job1",
      expect.any(String),
      expect.objectContaining({ fired: 0 }),
    );
  });

  it("still evaluates when ensure-defaults fails", async () => {
    mocks.ensureDefaultAlertRules.mockRejectedValueOnce(new Error("db busy"));
    expect(await runAlertEvaluationJobWorkerOnce("test")).toBe(true);
    expect(mocks.evaluateAlerts).toHaveBeenCalledTimes(1);
    expect(mocks.completeJob).toHaveBeenCalled();
  });
});
