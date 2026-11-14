// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  commandRequest: { findFirst: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  commandTarget: { updateMany: vi.fn() },
  executionLog: { create: vi.fn() },
}));
const permissions = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/lib/db", () => ({ prisma: db, isUniqueViolation: () => false }));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: (_session: unknown, permission: string) => permissions.granted.has(permission),
}));
vi.mock("@/lib/auth/team-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/team-scope")>()),
  commandRequestTeamWhere: () => ({}),
}));

const { cancelCommandRequest } = await import("../service-requests");

const session = { userId: "u1", username: "submitter", roles: ["operator"], currentTeamId: null } as never;
const request = (status: string, requesterId = "u1") => ({ id: "cmd1", status, requesterId, targets: [{ id: "t1", status }] });

/**
 * A member who may submit commands but not execute them could not take back a request nobody had approved yet
 * (the route required the execute permission). They may withdraw their own pending request; stopping a request
 * that is approved or running stays with those who execute commands.
 */
describe("withdrawing a command request without the execute permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions.granted = new Set(["command:create", "command:read"]);
    db.commandRequest.updateMany.mockResolvedValue({ count: 1 });
    db.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    db.executionLog.create.mockResolvedValue({});
    db.commandRequest.findUniqueOrThrow.mockResolvedValue({ id: "cmd1", status: "CANCELLED" });
  });

  it("withdraws the member's own request while it waits for approval", async () => {
    db.commandRequest.findFirst.mockResolvedValue(request("PENDING_APPROVAL"));
    await expect(cancelCommandRequest({ commandRequestId: "cmd1", actorId: "u1", session })).resolves.toMatchObject({ status: "CANCELLED" });
    expect(db.commandRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }));
  });

  it("refuses to stop the member's own request once it is approved or running", async () => {
    for (const status of ["APPROVED", "RUNNING"]) {
      db.commandRequest.findFirst.mockResolvedValue(request(status));
      await expect(cancelCommandRequest({ commandRequestId: "cmd1", actorId: "u1", session })).rejects.toThrow(/尚未审批|not been approved/);
    }
    expect(db.commandRequest.updateMany).not.toHaveBeenCalled();
  });

  it("refuses someone else's request", async () => {
    db.commandRequest.findFirst.mockResolvedValue(request("PENDING_APPROVAL", "u2"));
    await expect(cancelCommandRequest({ commandRequestId: "cmd1", actorId: "u1", session })).rejects.toThrow();
    expect(db.commandRequest.updateMany).not.toHaveBeenCalled();
  });

  it("leaves members who execute commands as they were: they stop their own running request", async () => {
    permissions.granted.add("command:execute");
    db.commandRequest.findFirst.mockResolvedValue(request("RUNNING"));
    db.commandRequest.findUniqueOrThrow.mockResolvedValue({ id: "cmd1", status: "CANCELLING" });
    await expect(cancelCommandRequest({ commandRequestId: "cmd1", actorId: "u1", session })).resolves.toMatchObject({ status: "CANCELLING" });
  });
});
