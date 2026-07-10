import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  sessionHasPermission: vi.fn(),
  createBackupRecord: vi.fn(),
  enqueueJob: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("@/lib/auth/require-session", () => ({
  requireSession: mocks.requireSession,
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: mocks.sessionHasPermission,
}));
vi.mock("@/lib/backup/service", () => ({
  createBackupRecord: mocks.createBackupRecord,
}));
vi.mock("@/lib/backup/job-worker", () => ({
  BACKUP_CREATE_JOB_TYPE: "backup.create",
}));
vi.mock("@/lib/job/service", () => ({
  enqueueJob: mocks.enqueueJob,
}));

const { createBackupAction } = await import("../actions");

describe("createBackupAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ userId: "u1", permissions: ["backup:create"] });
    mocks.sessionHasPermission.mockReturnValue(true);
    mocks.createBackupRecord.mockResolvedValue({ id: "bak1", status: "PENDING" });
    mocks.enqueueJob.mockResolvedValue({ id: "job1" });
  });

  it("queues backup creation as a durable background job instead of running it in the request", async () => {
    const formData = new FormData();
    formData.set("type", "FULL");
    formData.set("note", "  upgrade canary  ");

    await expect(createBackupAction({ success: false }, formData)).resolves.toEqual({ success: true });

    expect(mocks.createBackupRecord).toHaveBeenCalledWith({ type: "FULL", createdBy: "u1", note: "upgrade canary" });
    expect(mocks.enqueueJob).toHaveBeenCalledWith({
      type: "backup.create",
      title: "创建完整备份",
      payload: { backupId: "bak1" },
      createdBy: "u1",
      maxAttempts: 1,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/backups");
  });

  it("rejects invalid backup types before creating records", async () => {
    const formData = new FormData();
    formData.set("type", "SNAPSHOT");

    await expect(createBackupAction({ success: false }, formData)).resolves.toEqual({ success: false, error: "Invalid backup type" });

    expect(mocks.createBackupRecord).not.toHaveBeenCalled();
    expect(mocks.enqueueJob).not.toHaveBeenCalled();
  });
});
