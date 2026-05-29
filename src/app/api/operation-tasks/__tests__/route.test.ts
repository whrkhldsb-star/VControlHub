import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    listOperationTasks: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/operation-task/service", () => ({
  listOperationTasks: mocks.listOperationTasks,
}));

const route = await import("../route");

describe("/api/operation-tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1" } });
    mocks.listOperationTasks.mockResolvedValue([
      { id: "download:dl1", title: "a.iso" },
    ]);
  });

  it("returns unified tasks with a clamped limit", async () => {
    const response = await route.GET(
      new Request("http://local/api/operation-tasks?limit=999"),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("task:read");
    expect(mocks.listOperationTasks).toHaveBeenCalledWith({ limit: 200 });
    await expect(response.json()).resolves.toEqual({
      tasks: [{ id: "download:dl1", title: "a.iso" }],
    });
  });

  it("returns shared API permission failures without calling the service", async () => {
    mocks.requireApiPermission.mockResolvedValueOnce(
      Response.json({ error: "缺少权限" }, { status: 403 }),
    );

    const response = await route.GET(
      new Request("http://local/api/operation-tasks"),
    );

    expect(response.status).toBe(403);
    expect(mocks.listOperationTasks).not.toHaveBeenCalled();
  });
});
