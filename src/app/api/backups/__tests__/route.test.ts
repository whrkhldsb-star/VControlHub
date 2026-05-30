import { describe, expect, it, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    runBackupRecord: vi.fn(),
    listBackupRecords: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/backup/service", () => ({ runBackupRecord: mocks.runBackupRecord, listBackupRecords: mocks.listBackupRecords }));

const route = await import("../route");

describe("/api/backups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1", user: { id: "u1" } } });
    mocks.listBackupRecords.mockResolvedValue([{ id: "bak1" }]);
    mocks.runBackupRecord.mockImplementation(async (input: any) => ({ id: "bak1", status: "COMPLETED", ...input }));
  });

  it("requires backup:read for listing backups", async () => {
    mocks.requireApiPermission.mockResolvedValue(new Response(JSON.stringify({ error: "缺少权限" }), { status: 403 }));
    const res = await route.GET(new Request("http://local/api/backups"));
    expect(res.status).toBe(403);
    expect(mocks.listBackupRecords).not.toHaveBeenCalled();
  });

  it("creates and executes backups only with valid type and normalized note", async () => {
    const req = new Request("http://local/api/backups", { method: "POST", body: JSON.stringify({ type: "FULL", note: "  before upgrade  " }) });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    expect(mocks.runBackupRecord).toHaveBeenCalledWith({ type: "FULL", createdBy: "u1", note: "before upgrade" });
  });

  it("rejects invalid backup type instead of silently defaulting", async () => {
    const req = new Request("http://local/api/backups", { method: "POST", body: JSON.stringify({ type: "ROOT" }) });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
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
    expect(mocks.runBackupRecord).toHaveBeenCalledWith({ type: "DATABASE", createdBy: "u1", note: "pre upgrade" });
  });

});
