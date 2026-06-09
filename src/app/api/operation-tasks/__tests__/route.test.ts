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
    mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1" } });
    mocks.listOperationTaskResult.mockResolvedValue({
      tasks: [{ id: "download:dl1", title: "a.iso" }],
      sourceSummary: [{ source: "download", total: 1, attention: 1, failed: 0, running: 1, pending: 0 }],
    });
  });

  it("passes the caller limit to the bounded task service", async () => {
    const response = await route.GET(
      new Request("http://local/api/operation-tasks?limit=999"),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("task:read");
    expect(mocks.listOperationTaskResult).toHaveBeenCalledWith({ limit: 999, status: undefined, taskType: undefined });
    await expect(response.json()).resolves.toEqual({
      tasks: [{ id: "download:dl1", title: "a.iso" }],
      sourceSummary: [{ source: "download", total: 1, attention: 1, failed: 0, running: 1, pending: 0 }],
    });
  });

  it("passes status and task type filters to the bounded task service", async () => {
    const response = await route.GET(
      new Request("http://local/api/operation-tasks?status=failed,running&taskType=alert.evaluate&limit=50"),
    );

    expect(response.status).toBe(200);
    expect(mocks.listOperationTaskResult).toHaveBeenCalledWith({ limit: 50, status: ["failed", "running"], taskType: "alert.evaluate" });
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
