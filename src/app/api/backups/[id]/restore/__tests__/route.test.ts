import { describe, expect, it, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    restoreBackupRecord: vi.fn(),
    getBackupRecord: vi.fn(),
    enqueueJob: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/backup/service", () => ({ restoreBackupRecord: mocks.restoreBackupRecord, getBackupRecord: mocks.getBackupRecord }));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/backup/job-worker", () => ({ BACKUP_RESTORE_JOB_TYPE: "backup.restore" }));

const route = await import("../route");

describe("/api/backups/[id]/restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1", user: { id: "u1" } } });
    mocks.getBackupRecord.mockResolvedValue({ id: "bak1" });
    mocks.enqueueJob.mockResolvedValue({ id: "job1", status: "PENDING" });
    mocks.restoreBackupRecord.mockResolvedValue({ id: "bak1", restoredAt: "2026-05-30T00:00:00.000Z" });
  });

  it("requires backup:restore before executing any restore side effect", async () => {
    mocks.requireApiPermission.mockResolvedValue(new Response(JSON.stringify({ error: "缺少权限" }), { status: 403 }));

    const response = await route.POST(new Request("http://local/api/backups/bak1/restore", { method: "POST", body: JSON.stringify({ confirm: "RESTORE" }) }), { params: Promise.resolve({ id: "bak1" }) });

    expect(response.status).toBe(403);
    expect(mocks.restoreBackupRecord).not.toHaveBeenCalled();
  });

  it("rejects restore requests without explicit RESTORE confirmation", async () => {
    const response = await route.POST(new Request("http://local/api/backups/bak1/restore", { method: "POST", body: JSON.stringify({ confirm: "restore" }) }), { params: Promise.resolve({ id: "bak1" }) });

    expect(response.status).toBe(400);
    expect(mocks.restoreBackupRecord).not.toHaveBeenCalled();
  });

  it("queues restore through a durable background job after permission and confirmation checks", async () => {
    const response = await route.POST(new Request("http://local/api/backups/bak1/restore", { method: "POST", body: JSON.stringify({ confirm: "RESTORE" }) }), { params: Promise.resolve({ id: "bak1" }) });

    expect(response.status).toBe(202);
    expect(mocks.getBackupRecord).toHaveBeenCalledWith("bak1");
    expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: "backup.restore", payload: { backupId: "bak1", confirm: "RESTORE" } }));
    await expect(response.json()).resolves.toMatchObject({ jobId: "job1", taskId: "job:job1" });
  });

  it("supports wait=1 for legacy synchronous restore execution", async () => {
    const response = await route.POST(new Request("http://local/api/backups/bak1/restore?wait=1", { method: "POST", body: JSON.stringify({ confirm: "RESTORE" }) }), { params: Promise.resolve({ id: "bak1" }) });

    expect(response.status).toBe(200);
    expect(mocks.restoreBackupRecord).toHaveBeenCalledWith({ id: "bak1", confirm: "RESTORE" });
    await expect(response.json()).resolves.toMatchObject({ restore: { id: "bak1" } });
  });

  it("maps missing backup records to 404 instead of claiming restore success", async () => {
    mocks.getBackupRecord.mockResolvedValueOnce(null);

    const response = await route.POST(new Request("http://local/api/backups/missing/restore", { method: "POST", body: JSON.stringify({ confirm: "RESTORE" }) }), { params: Promise.resolve({ id: "missing" }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Backup record not found" });
  });
});
