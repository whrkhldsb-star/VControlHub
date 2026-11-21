import { describe, expect, it, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getBackupRecord: vi.fn(),
    prepareBackupRecordRetry: vi.fn(),
    enqueueJob: vi.fn(),
    jobFindFirst: vi.fn(),
    backupUpdateMany: vi.fn(async () => ({ count: 1 })),
  },
}));

vi.mock("@/lib/backup/service", () => ({ getBackupRecord: mocks.getBackupRecord, prepareBackupRecordRetry: mocks.prepareBackupRecordRetry }));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/backup/job-worker", () => ({ BACKUP_CREATE_JOB_TYPE: "backup.create" }));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction(work: (tx: unknown) => unknown) { return work(this); },
    job: { findFirst: mocks.jobFindFirst },
    backupRecord: { updateMany: mocks.backupUpdateMany },
  },
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn() }));
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: async (_request: Request, _options: unknown, handler: (ctx: { session: { userId: string; currentTeamId?: string | null } }) => Promise<Response>) =>
    handler({ session: { userId: "u1", currentTeamId: null } }),
}));

const route = await import("../route");

describe("/api/backups/[id]/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackupRecord.mockResolvedValue({ id: "bak1", teamId: "selected" });
    mocks.jobFindFirst.mockResolvedValue(null);
    mocks.prepareBackupRecordRetry.mockResolvedValue({ id: "bak1", type: "DATABASE", status: "PENDING", teamId: null });
    mocks.enqueueJob.mockResolvedValue({ id: "job1", status: "PENDING" });
  });

  it("prepares a failed backup record and queues a durable retry job", async () => {
    const res = await route.POST(new Request("http://local/api/backups/bak1/retry", { method: "POST" }), { params: Promise.resolve({ id: "bak1" }) });

    expect(res.status).toBe(202);
    expect(mocks.jobFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ teamId: "selected" }) }));
    expect(mocks.prepareBackupRecordRetry).toHaveBeenCalledWith({ id: "bak1", session: expect.objectContaining({ userId: "u1" }) }, expect.anything());
    expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      type: "backup.create",
      title: "Retry DATABASE backup",
      payload: { backupId: "bak1", teamId: null },
      createdBy: "u1",
      maxAttempts: 1,
    }), expect.anything());
    await expect(res.json()).resolves.toMatchObject({ backup: { id: "bak1", status: "PENDING" }, jobId: "job1", taskId: "job:job1", deduped: false });
  });

  it("returns the existing in-flight job without re-CAS when deduped", async () => {
    mocks.jobFindFirst.mockResolvedValue({ id: "job-existing" });

    const res = await route.POST(new Request("http://local/api/backups/bak1/retry", { method: "POST" }), { params: Promise.resolve({ id: "bak1" }) });

    expect(res.status).toBe(202);
    expect(mocks.prepareBackupRecordRetry).not.toHaveBeenCalled();
    expect(mocks.enqueueJob).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ jobId: "job-existing", taskId: "job:job-existing", deduped: true });
  });

  it("checks the view before disclosing an active job", async () => {
    mocks.getBackupRecord.mockResolvedValue(null);
    mocks.jobFindFirst.mockResolvedValue({ id: "other-job" });
    await expect(route.POST(new Request("http://local/retry", { method: "POST" }), { params: Promise.resolve({ id: "bak1" }) })).rejects.toMatchObject({ name: "NotFoundError" });
    expect(mocks.jobFindFirst).not.toHaveBeenCalled();
  });

  it("aborts the transaction when enqueue fails", async () => {
    mocks.enqueueJob.mockRejectedValueOnce(new Error("connection reset"));
    await expect(route.POST(new Request("http://local/retry", { method: "POST" }), { params: Promise.resolve({ id: "bak1" }) })).rejects.toThrow("connection reset");
    expect(mocks.prepareBackupRecordRetry.mock.calls[0]![1]).toBe(mocks.enqueueJob.mock.calls[0]![1]);
    expect(mocks.backupUpdateMany).not.toHaveBeenCalled();
  });
});
