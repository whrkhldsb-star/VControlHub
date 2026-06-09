import { describe, expect, it, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    prepareBackupRecordRetry: vi.fn(),
    enqueueJob: vi.fn(),
  },
}));

vi.mock("@/lib/backup/service", () => ({ prepareBackupRecordRetry: mocks.prepareBackupRecordRetry }));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/backup/job-worker", () => ({ BACKUP_CREATE_JOB_TYPE: "backup.create" }));
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: async (_request: Request, _options: unknown, handler: (ctx: { session: { userId: string } }) => Promise<Response>) => handler({ session: { userId: "u1" } }),
}));

const route = await import("../route");

describe("/api/backups/[id]/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepareBackupRecordRetry.mockResolvedValue({ id: "bak1", type: "DATABASE", status: "PENDING" });
    mocks.enqueueJob.mockResolvedValue({ id: "job1", status: "PENDING" });
  });

  it("prepares a failed backup record and queues a durable retry job", async () => {
    const res = await route.POST(new Request("http://local/api/backups/bak1/retry", { method: "POST" }), { params: Promise.resolve({ id: "bak1" }) });

    expect(res.status).toBe(202);
    expect(mocks.prepareBackupRecordRetry).toHaveBeenCalledWith({ id: "bak1" });
    expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      type: "backup.create",
      title: "重试DATABASE备份",
      payload: { backupId: "bak1" },
      createdBy: "u1",
      maxAttempts: 1,
    }));
    await expect(res.json()).resolves.toMatchObject({ backup: { id: "bak1", status: "PENDING" }, jobId: "job1", taskId: "job:job1" });
  });
});
