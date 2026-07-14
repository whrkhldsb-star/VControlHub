import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    listOperationTaskResult: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/operation-task/service", () => ({
  listOperationTaskResult: mocks.listOperationTaskResult,
}));

const route = await import("../route");

describe("/api/operation-tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1", roles: ["viewer"], currentTeamId: "team-1" } });
    mocks.listOperationTaskResult.mockResolvedValue({
      tasks: [{ id: "download:dl1", title: "a.iso" }],
      sourceSummary: [{ source: "download", total: 1, attention: 1, failed: 0, running: 1, pending: 0 }],
      failureSummary: [],
    });
  });

  it("passes the caller limit to the bounded task service", async () => {
    const response = await route.GET(
      new Request("http://local/api/operation-tasks?limit=999"),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("task:read");
    expect(mocks.listOperationTaskResult).toHaveBeenCalledWith(
      { limit: 999, status: undefined, taskType: undefined, sort: undefined },
      { userId: "u1", roles: ["viewer"], currentTeamId: "team-1" },
    );
    await expect(response.json()).resolves.toEqual({
      tasks: [{ id: "download:dl1", title: "a.iso" }],
      sourceSummary: [{ source: "download", total: 1, attention: 1, failed: 0, running: 1, pending: 0 }],
      failureSummary: [],
    });
  });

  it("passes status, task type, and sort filters to the bounded task service", async () => {
    const response = await route.GET(
      new Request("http://local/api/operation-tasks?status=failed,running&taskType=alert.evaluate&sort=attention&limit=50"),
    );

    expect(response.status).toBe(200);
    expect(mocks.listOperationTaskResult).toHaveBeenCalledWith(
      { limit: 50, status: ["failed", "running"], taskType: "alert.evaluate", sort: "attention" },
      { userId: "u1", roles: ["viewer"], currentTeamId: "team-1" },
    );
  });

  it("exports the current filtered task list as escaped CSV", async () => {
    mocks.listOperationTaskResult.mockResolvedValueOnce({
      tasks: [{
        id: "job:job_1",
        source: "job",
        sourceId: "job_1",
        taskType: "backup.create",
        status: "failed",
        title: "备份失败, 需要处理",
        actor: "alice",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
        progress: "line one",
        logPreview: ["stderr: a,b", "quoted \"value\""],
        foldedCount: 2,
        href: "/tasks",
      }],
      sourceSummary: [],
      failureSummary: [],
    });

    const response = await route.GET(
      new Request("http://local/api/operation-tasks?status=failed,running&taskType=backup.create&format=csv"),
    );
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("operation-tasks.csv");
    expect(mocks.listOperationTaskResult).toHaveBeenCalledWith(
      { limit: undefined, status: ["failed", "running"], taskType: "backup.create", sort: undefined },
      { userId: "u1", roles: ["viewer"], currentTeamId: "team-1" },
    );
    expect(body).toContain("id,source,sourceId,taskType,status,title,actor,createdAt,updatedAt,progress,logPreview,foldedCount,href");
    expect(body).toContain('"备份失败, 需要处理"');
    expect(body).toContain('"stderr: a,b\nquoted ""value"""');
  });

  it("ignores unsupported sort values", async () => {
    const response = await route.GET(
      new Request("http://local/api/operation-tasks?sort=oldest"),
    );

    expect(response.status).toBe(200);
    expect(mocks.listOperationTaskResult).toHaveBeenCalledWith(
      { limit: undefined, status: undefined, taskType: undefined, sort: undefined },
      { userId: "u1", roles: ["viewer"], currentTeamId: "team-1" },
    );
  });

  it("returns shared API permission failures without calling the service", async () => {
    mocks.requireApiPermission.mockResolvedValueOnce(
      Response.json({ error: "缺少权限" }, { status: 403 }),
    );

    const response = await route.GET(
      new Request("http://local/api/operation-tasks"),
    );

    expect(response.status).toBe(403);
    expect(mocks.listOperationTaskResult).not.toHaveBeenCalled();
  });
});
