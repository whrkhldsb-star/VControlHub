import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  unique: vi.fn(),
  entries: vi.fn(),
  access: vi.fn(),
  transaction: vi.fn(),
  body: {} as Record<string, unknown>,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    job: { findMany: mocks.list, findUnique: mocks.unique },
    fileEntry: { findMany: mocks.entries },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: (
    _request: Request,
    _options: unknown,
    handler: (context: unknown) => unknown,
  ) =>
    handler({
      session: { userId: "user", currentTeamId: "team" },
      body: mocks.body,
    }),
  requestLocale: () => "en",
}));
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: () => ({ teamId: "team" }),
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: () => true,
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: mocks.access,
}));
import { GET, POST } from "../route";

const payload = {
  requestId: "89d25d27-5d36-4f9d-9350-c43fdd125114",
  action: "copy",
  fileEntryIds: ["ok", "uncertain", "failed", "pending"],
  targetDir: "target",
  policy: "rename",
};
beforeEach(() => {
  vi.resetAllMocks();
});
describe("file operation task listing", () => {
  it.each(["copy", "move", "delete"])(
    "checks source path permissions before persisting a %s task",
    async (action) => {
      mocks.body = { ...payload, action, fileEntryIds: ["private"] };
      mocks.unique.mockResolvedValue(null);
      mocks.entries.mockResolvedValue([
        {
          id: "private",
          storageNodeId: "node",
          relativePath: "restricted/private.txt",
          entryType: "FILE",
        },
      ]);
      mocks.access.mockResolvedValue({ allowed: false });
      await expect(
        POST(
          new Request("http://local/api/files/operations", { method: "POST" }),
        ),
      ).rejects.toThrow();
      expect(mocks.access).toHaveBeenCalledWith(
        expect.objectContaining({
          relativePath: "restricted/private.txt",
          operation:
            action === "copy" ? "read" : action === "move" ? "write" : "delete",
        }),
      );
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
  it("deduplicates a job that finishes between the two reads", async () => {
    mocks.list
      .mockResolvedValueOnce([{ id: "changing", status: "RUNNING", payload }])
      .mockResolvedValueOnce([
        { id: "changing", status: "COMPLETED", payload },
      ]);
    const result = await (
      await GET(new Request("http://local/api/files/operations"))
    ).json();
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].status).toBe("COMPLETED");
  });
  it("retains old active jobs when many newer jobs have completed", async () => {
    mocks.list
      .mockResolvedValueOnce([
        { id: "old-running", status: "RUNNING", payload },
      ])
      .mockResolvedValueOnce(
        Array.from({ length: 30 }, (_, index) => ({
          id: `new-${index}`,
          status: "COMPLETED",
          payload,
        })),
      );
    const response = await GET(
      new Request("http://local/api/files/operations"),
    );
    const result = await response.json();
    expect(result.jobs).toHaveLength(31);
    expect(result.jobs[0]).toMatchObject({ id: "old-running", retry: null });
    expect(mocks.list).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          type: "storage.file-operation",
          createdBy: "user",
          teamId: "team",
          status: { in: ["PENDING", "RUNNING"] },
        },
        take: 20,
      }),
    );
    expect(mocks.list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          type: "storage.file-operation",
          createdBy: "user",
          teamId: "team",
          status: { notIn: ["PENDING", "RUNNING"] },
        },
        take: 30,
      }),
    );
  });
  it("only offers retry for confirmed failures and roots that never started", async () => {
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "failed-job",
        status: "FAILED",
        payload,
        result: {
          items: [
            { id: "ok", state: "success" },
            { id: "uncertain", state: "running" },
            { id: "failed", state: "error" },
          ],
        },
      },
    ]);
    const result = await (
      await GET(new Request("http://local/api/files/operations"))
    ).json();
    expect(result.jobs[0].retry.fileEntryIds).toEqual(["failed", "pending"]);
  });
});
