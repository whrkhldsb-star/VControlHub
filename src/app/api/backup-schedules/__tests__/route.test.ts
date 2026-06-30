import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiPermissionMock,
  createBackupScheduleMock,
  listBackupSchedulesMock,
  toggleBackupScheduleMock,
  updateBackupScheduleMock,
} = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  createBackupScheduleMock: vi.fn(),
  listBackupSchedulesMock: vi.fn(),
  toggleBackupScheduleMock: vi.fn(),
  updateBackupScheduleMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/backup/schedule-service", () => ({
  createBackupSchedule: createBackupScheduleMock,
  listBackupSchedules: listBackupSchedulesMock,
  toggleBackupSchedule: toggleBackupScheduleMock,
  updateBackupSchedule: updateBackupScheduleMock,
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const route = await import("../route");

const session = { userId: "u1", username: "alice", roles: ["admin"] };

function jsonRequest(method: string, body: unknown) {
  return new Request("http://local/api/backup-schedules", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/backup-schedules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValue({ session });
    listBackupSchedulesMock.mockResolvedValue([{ id: "s1", name: "Nightly DB" }]);
    createBackupScheduleMock.mockImplementation((input: { name: string; cronExpression: string; backupType: string; createdById?: string }) =>
      Promise.resolve({
        id: "s1",
        name: input.name,
        cronExpression: input.cronExpression,
        backupType: input.backupType,
        createdById: input.createdById ?? null,
      }),
    );
    toggleBackupScheduleMock.mockResolvedValue({ id: "s1", status: "PAUSED" });
    updateBackupScheduleMock.mockResolvedValue({ id: "s1" });
  });

  it("uses backup:read for GET", async () => {
    await route.GET(new Request("http://local/api/backup-schedules", { method: "GET" }));
    expect(requireApiPermissionMock).toHaveBeenCalledWith("backup:read");
  });

  it("uses backup:create for POST", async () => {
    await route.POST(
      jsonRequest("POST", {
        name: "Nightly DB",
        cronExpression: "0 3 * * *",
        backupType: "DATABASE",
      }),
    );
    expect(requireApiPermissionMock).toHaveBeenCalledWith("backup:create");
  });

  it("creates a schedule with the session userId as createdById", async () => {
    const res = await route.POST(
      jsonRequest("POST", {
        name: "Nightly DB",
        cronExpression: "0 3 * * *",
        backupType: "DATABASE",
      }),
    );
    expect(res.status).toBe(201);
    expect(createBackupScheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Nightly DB",
        cronExpression: "0 3 * * *",
        backupType: "DATABASE",
        createdById: "u1",
      }),
    );
  });

  it("rejects invalid backupType before reaching the service", async () => {
    const res = await route.POST(
      jsonRequest("POST", {
        name: "Bad type",
        cronExpression: "0 3 * * *",
        backupType: "WAL",
      }),
    );
    expect(res.status).toBe(400);
    expect(createBackupScheduleMock).not.toHaveBeenCalled();
  });

  it("rejects missing name before reaching the service", async () => {
    const res = await route.POST(
      jsonRequest("POST", {
        name: "",
        cronExpression: "0 3 * * *",
        backupType: "DATABASE",
      }),
    );
    expect(res.status).toBe(400);
    expect(createBackupScheduleMock).not.toHaveBeenCalled();
  });

  it("dispatches toggle when patch body has toggleId", async () => {
    const res = await route.PATCH(
      jsonRequest("PATCH", { toggleId: "s1" }),
    );
    expect(res.status).toBe(200);
    expect(toggleBackupScheduleMock).toHaveBeenCalledWith("s1");
    expect(updateBackupScheduleMock).not.toHaveBeenCalled();
  });

  it("dispatches update when patch body has id", async () => {
    const res = await route.PATCH(
      jsonRequest("PATCH", { id: "s1", name: "Renamed" }),
    );
    expect(res.status).toBe(200);
    expect(updateBackupScheduleMock).toHaveBeenCalledWith("s1", { name: "Renamed" });
    expect(toggleBackupScheduleMock).not.toHaveBeenCalled();
  });

  it("rejects a patch with neither toggleId nor id", async () => {
    const res = await route.PATCH(
      jsonRequest("PATCH", { unknownField: "x" }),
    );
    expect(res.status).toBe(400);
  });
});
