import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiPermission: vi.fn(),
  jobFindFirst: vi.fn(),
  listJobEvents: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/db", () => ({ prisma: { job: { findFirst: mocks.jobFindFirst } } }));
vi.mock("@/lib/job/events", () => ({ listJobEvents: mocks.listJobEvents }));

const route = await import("../route");

const viewerSession = { userId: "user-1", roles: ["viewer"], currentTeamId: "team-1" };

describe("GET /api/jobs/[id]/events ownership scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: viewerSession });
    mocks.jobFindFirst.mockResolvedValue({ id: "job-1" });
    mocks.listJobEvents.mockResolvedValue([]);
  });

  it("requires an ordinary task reader to own the job in the active team", async () => {
    const response = await route.GET(new Request("http://local/api/jobs/job-1/events"), { params: Promise.resolve({ id: "job-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.jobFindFirst).toHaveBeenCalledWith({
      where: {
        AND: [
          { id: "job-1" },
          { OR: [{ teamId: "team-1" }, { teamId: null }] },
          { createdBy: "user-1" },
        ],
      },
      select: { id: true },
    });
    expect(mocks.listJobEvents).toHaveBeenCalledWith({ jobId: "job-1", limit: undefined, beforeId: undefined });
  });

  it("allows team managers to inspect jobs in their team scope", async () => {
    mocks.requireApiPermission.mockResolvedValueOnce({ session: { userId: "admin-1", roles: ["admin"], currentTeamId: "team-1" } });
    const response = await route.GET(new Request("http://local/api/jobs/job-1/events"), { params: Promise.resolve({ id: "job-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.jobFindFirst).toHaveBeenCalledWith({ where: { id: "job-1" }, select: { id: true } });
  });

  it("returns not found without leaking events when the scoped job is inaccessible", async () => {
    mocks.jobFindFirst.mockResolvedValueOnce(null);
    const response = await route.GET(new Request("http://local/api/jobs/other/events"), { params: Promise.resolve({ id: "other" }) });
    expect(response.status).toBe(404);
    expect(mocks.listJobEvents).not.toHaveBeenCalled();
  });
});
