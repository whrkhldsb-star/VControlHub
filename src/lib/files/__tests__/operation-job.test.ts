import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  heartbeat: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  cancel: vi.fn(),
  user: vi.fn(),
  permission: vi.fn(),
  membership: vi.fn(),
  latest: vi.fn(),
  checkpoint: vi.fn(),
  copy: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    job: { findUnique: mocks.latest, updateMany: mocks.checkpoint },
    teamMember: { findUnique: mocks.membership },
  },
}));
vi.mock("@/lib/job/service", () => ({
  claimNextJob: mocks.claim,
  heartbeatJob: mocks.heartbeat,
  completeJob: mocks.complete,
  failJob: mocks.fail,
  cancelJob: mocks.cancel,
}));
vi.mock("@/lib/api-token/authorization", () => ({
  loadApiTokenOwnerSession: mocks.user,
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: mocks.permission,
}));
vi.mock("../copy-operation", () => ({ copyFileEntry: mocks.copy }));
vi.mock("../move-operation", () => ({ executeMoveFile: mocks.move }));
vi.mock("../delete-operation", () => ({ executeDeleteFile: mocks.remove }));
import { runFileOperationWorkerOnce } from "../operation-job";
import { FileOperationUncertainError } from "../operation-schema";
const payload = {
  requestId: "89d25d27-5d36-4f9d-9350-c43fdd125114",
  action: "copy",
  fileEntryIds: ["a", "b"],
  targetDir: "destination",
  policy: "rename",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.claim.mockResolvedValue({
    id: "job",
    payload,
    createdBy: "user",
    teamId: "original-team",
  });
  mocks.latest.mockResolvedValue({ status: "RUNNING", payload });
  mocks.membership.mockResolvedValue({ userId: "user" });
  mocks.user.mockImplementation(async () => ({
    userId: "user",
    currentTeamId: "different-team",
    roles: ["operator"],
  }));
  mocks.permission.mockReturnValue(true);
  mocks.checkpoint.mockResolvedValue({ count: 1 });
  mocks.heartbeat.mockResolvedValue({ count: 1 });
  mocks.copy.mockResolvedValue({ path: "destination/a", skipped: false });
});
describe("durable file operation worker", () => {
  it("keeps ambiguous copy outcomes unconfirmed and excluded from safe retries", async () => {
    const checkpoints: unknown[] = [];
    mocks.checkpoint.mockImplementation(async ({ data }) => {
      checkpoints.push(JSON.parse(JSON.stringify(data)));
      return { count: 1 };
    });
    mocks.copy.mockRejectedValueOnce(
      new FileOperationUncertainError("inspect destination"),
    );
    await runFileOperationWorkerOnce();
    expect(checkpoints.at(-1)).toMatchObject({
      result: {
        items: [
          { id: "a", state: "running", error: "inspect destination" },
          { id: "b", state: "success" },
        ],
      },
    });
    expect(mocks.fail).toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("persists an in-flight checkpoint and individual results, keeping the original workspace", async () => {
    const checkpoints: unknown[] = [];
    mocks.checkpoint.mockImplementation(async ({ data }) => {
      checkpoints.push(JSON.parse(JSON.stringify(data)));
      return { count: 1 };
    });
    mocks.copy
      .mockResolvedValueOnce({ path: "destination/a", skipped: false })
      .mockRejectedValueOnce(new Error("disk full"));
    await runFileOperationWorkerOnce();
    expect(mocks.copy.mock.calls[0]![0].session.currentTeamId).toBe(
      "original-team",
    );
    expect(mocks.user).toHaveBeenCalledTimes(2);
    expect(checkpoints[0]).toMatchObject({
      result: { items: [{ id: "a", state: "running" }] },
    });
    expect(checkpoints.at(-1)).toMatchObject({
      result: {
        items: [
          { id: "a", state: "success" },
          { id: "b", state: "error", error: "disk full" },
        ],
      },
      progress: "2/2",
    });
    expect(mocks.fail).toHaveBeenCalledWith(
      "job",
      expect.any(String),
      "1 item(s) failed",
    );
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("does not execute queued mutations after permission revocation", async () => {
    mocks.permission.mockReturnValue(false);
    await runFileOperationWorkerOnce();
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalled();
  });
  it("stops when the original team membership is removed", async () => {
    mocks.membership.mockResolvedValue(null);
    await runFileOperationWorkerOnce();
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalled();
  });
  it("honors cancellation before starting another item", async () => {
    mocks.latest
      .mockResolvedValueOnce({ status: "RUNNING", payload })
      .mockResolvedValueOnce({
        status: "RUNNING",
        payload: { ...payload, cancelRequested: true },
      });
    await runFileOperationWorkerOnce();
    expect(mocks.copy).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledWith(
      "job",
      expect.objectContaining({ currentTeamId: "original-team" }),
    );
  });
  it("does not start writes if its checkpoint loses the job lease", async () => {
    mocks.checkpoint.mockResolvedValue({ count: 0 });
    await runFileOperationWorkerOnce();
    expect(mocks.copy).not.toHaveBeenCalled();
  });
});

it("keeps an uncertain move excluded from normal failed-item retries", async () => {
  const movePayload = { ...payload, action: "move" };
  mocks.claim.mockResolvedValue({ id: "job", payload: movePayload, createdBy: "user", teamId: "original-team" });
  mocks.latest.mockResolvedValue({ status: "RUNNING", payload: movePayload });
  mocks.move.mockRejectedValueOnce(new FileOperationUncertainError("inspect both paths")).mockResolvedValueOnce({success:"ok"});
  await runFileOperationWorkerOnce();
  expect(mocks.checkpoint.mock.calls.at(-1)?.[0].data.result.items).toEqual([
    expect.objectContaining({id:"a",state:"running",error:"inspect both paths"}),
    expect.objectContaining({id:"b",state:"success"}),
  ]);
  expect(mocks.fail).toHaveBeenCalled();
  expect(mocks.complete).not.toHaveBeenCalled();
});
