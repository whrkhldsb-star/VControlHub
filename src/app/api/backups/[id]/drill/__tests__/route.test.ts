import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireApiPermission: vi.fn(), getBackupRecord: vi.fn(), jobFindFirst: vi.fn(), enqueueJob: vi.fn(), auditUserAction: vi.fn() }));
vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/backup/service", () => ({ getBackupRecord: mocks.getBackupRecord }));
vi.mock("@/lib/db", () => ({ prisma: { job: { findFirst: mocks.jobFindFirst } } }));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("@/lib/backup/job-worker", () => ({ BACKUP_DRILL_JOB_TYPE: "backup.drill" }));

const route = await import("../route");
const session = { userId: "u1", roles: ["operator"], currentTeamId: "team-1" };

describe("backup drill route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireApiPermission.mockResolvedValue({ session }); mocks.getBackupRecord.mockResolvedValue({ id: "b1", type: "DATABASE", status: "COMPLETED" }); mocks.jobFindFirst.mockResolvedValue(null); mocks.enqueueJob.mockResolvedValue({ id: "j1" }); mocks.auditUserAction.mockResolvedValue(undefined); });
  it("scopes the backup lookup and enqueued job to the current team", async () => {
    const response = await route.POST(new Request("http://local/api/backups/b1/drill", { method: "POST" }), { params: Promise.resolve({ id: "b1" }) });
    expect(response.status).toBe(202);
    expect(mocks.getBackupRecord).toHaveBeenCalledWith("b1", session);
    expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: "backup.drill", createdBy: "u1", teamId: "team-1", payload: expect.objectContaining({ backupId: "b1", teamId: "team-1" }) }));
  });
});
