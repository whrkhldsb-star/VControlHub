import { describe, expect, it, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    voidBackupRecord: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/backup/service", () => ({ voidBackupRecord: mocks.voidBackupRecord }));

const route = await import("../route");

describe("/api/backups/[id]/void", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1", user: { id: "u1" } } });
    mocks.voidBackupRecord.mockImplementation(async (input: any) => ({ id: input.id, status: "VOIDED", errorMessage: `已作废：${input.reason}` }));
  });

  it("requires backup:create before voiding a backup record", async () => {
    mocks.requireApiPermission.mockResolvedValue(new Response(JSON.stringify({ error: "缺少权限" }), { status: 403 }));

    const res = await route.POST(new Request("http://local/api/backups/bak1/void", { method: "POST", body: JSON.stringify({ reason: "cleanup" }) }), { params: Promise.resolve({ id: "bak1" }) });

    expect(res.status).toBe(403);
    expect(mocks.voidBackupRecord).not.toHaveBeenCalled();
  });

  it("marks a stale backup record void with an explicit reason", async () => {
    const res = await route.POST(new Request("http://local/api/backups/bak1/void", { method: "POST", body: JSON.stringify({ reason: " 历史记录不再执行 " }) }), { params: Promise.resolve({ id: "bak1" }) });

    expect(res.status).toBe(200);
    expect(mocks.voidBackupRecord).toHaveBeenCalledWith({ id: "bak1", reason: "历史记录不再执行", session: expect.objectContaining({ userId: "u1" }) });
    await expect(res.json()).resolves.toMatchObject({ backup: { id: "bak1", status: "VOIDED" } });
  });

  it("rejects empty void reasons", async () => {
    const res = await route.POST(new Request("http://local/api/backups/bak1/void", { method: "POST", body: JSON.stringify({ reason: "   " }) }), { params: Promise.resolve({ id: "bak1" }) });

    expect(res.status).toBe(400);
    expect(mocks.voidBackupRecord).not.toHaveBeenCalled();
  });
});
