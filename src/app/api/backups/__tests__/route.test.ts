import { describe, expect, it, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    runBackupRecord: vi.fn(),
    createBackupRecord: vi.fn(),
    enqueueJob: vi.fn(),
    listBackupRecords: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/backup/service", () => ({
  runBackupRecord: mocks.runBackupRecord,
  createBackupRecord: mocks.createBackupRecord,
  listBackupRecords: mocks.listBackupRecords,
}));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/backup/job-worker", () => ({ BACKUP_CREATE_JOB_TYPE: "backup.create" }));

const route = await import("../route");

describe("/api/backups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1", user: { id: "u1" } } });
    mocks.listBackupRecords.mockResolvedValue([{ id: "bak1" }]);
    mocks.createBackupRecord.mockImplementation(async (input: any) => ({ id: "bak1", status: "PENDING", ...input }));
    mocks.enqueueJob.mockResolvedValue({ id: "job1", status: "PENDING" });
    mocks.runBackupRecord.mockImplementation(async (input: any) => ({ id: "bak1", status: "COMPLETED", ...input }));
  });

  it("requires backup:read for listing backups", async () => {
    mocks.requireApiPermission.mockResolvedValue(new Response(JSON.stringify({ error: "缺少权限" }), { status: 403 }));
    const res = await route.GET(new Request("http://local/api/backups"));
    expect(res.status).toBe(403);
    expect(mocks.listBackupRecords).not.toHaveBeenCalled();
  });

  it("queues backup creation as a durable background job by default", async () => {
    const req = new Request("http://local/api/backups", { method: "POST", body: JSON.stringify({ type: "FULL", note: "  before upgrade  " }) });
    const res = await route.POST(req);
    expect(res.status).toBe(202);
    expect(mocks.createBackupRecord).toHaveBeenCalledWith({ type: "FULL", createdBy: "u1", note: "before upgrade" });
    expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: "backup.create", payload: { backupId: "bak1" } }));
    await expect(res.json()).resolves.toMatchObject({ backup: { id: "bak1" }, jobId: "job1", taskId: "job:job1" });
  });

  it("supports wait=1 for legacy synchronous backup execution", async () => {
    const req = new Request("http://local/api/backups?wait=1", { method: "POST", body: JSON.stringify({ type: "FULL", note: "  before upgrade  " }) });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    expect(mocks.runBackupRecord).toHaveBeenCalledWith({ type: "FULL", createdBy: "u1", note: "before upgrade" });
  });

  it("rejects malformed backup JSON with the shared bodySchema error envelope", async () => {
    const req = new Request("http://local/api/backups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });

    const res = await route.POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "请求体不是合法的 JSON" });
    expect(mocks.createBackupRecord).not.toHaveBeenCalled();
    expect(mocks.runBackupRecord).not.toHaveBeenCalled();
  });

  it("accepts browser form submissions and redirects back to backups page", async () => {
    const req = new Request("http://local/api/backups", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      body: new URLSearchParams({ type: "DATABASE", note: "pre upgrade" }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://local/backups");
    expect(mocks.createBackupRecord).toHaveBeenCalledWith({ type: "DATABASE", createdBy: "u1", note: "pre upgrade" });
    expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: "backup.create", payload: { backupId: "bak1" } }));
  });

});
