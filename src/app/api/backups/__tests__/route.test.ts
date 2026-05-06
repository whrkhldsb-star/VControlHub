import { describe, expect, it, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireSession: vi.fn(),
    sessionHasPermission: vi.fn(),
    createBackupRecord: vi.fn(),
    listBackupRecords: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: mocks.sessionHasPermission }));
vi.mock("@/lib/backup/service", () => ({ createBackupRecord: mocks.createBackupRecord, listBackupRecords: mocks.listBackupRecords }));

const route = await import("../route");

describe("/api/backups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ userId: "u1", user: { id: "u1" } });
    mocks.sessionHasPermission.mockReturnValue(true);
    mocks.listBackupRecords.mockResolvedValue([{ id: "bak1" }]);
    mocks.createBackupRecord.mockImplementation(async (input: any) => ({ id: "bak1", ...input }));
  });

  it("requires backup:read for listing backups", async () => {
    mocks.sessionHasPermission.mockReturnValue(false);
    const res = await route.GET();
    expect(res.status).toBe(403);
    expect(mocks.listBackupRecords).not.toHaveBeenCalled();
  });

  it("creates backups only with valid type and normalized note", async () => {
    const req = new Request("http://local/api/backups", { method: "POST", body: JSON.stringify({ type: "FULL", note: "  before upgrade  " }) });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    expect(mocks.createBackupRecord).toHaveBeenCalledWith({ type: "FULL", createdBy: "u1", note: "before upgrade" });
  });

  it("rejects invalid backup type instead of silently defaulting", async () => {
    const req = new Request("http://local/api/backups", { method: "POST", body: JSON.stringify({ type: "ROOT" }) });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
    expect(mocks.createBackupRecord).not.toHaveBeenCalled();
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
  });

});
