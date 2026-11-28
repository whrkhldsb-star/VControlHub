import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as pollFilesRoute } from "@/app/api/agent/v1/files/route";
import { callFileAgent, FILE_AGENT_CLAIM_LEASE_MS, parseFileCredential, pollFileAgent } from "../agent-file-queue";

const { db, delay } = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    agentFileShare: {
      findFirst: vi.fn(),
    },
    setting: {
      deleteMany: vi.fn(),
    },
    agentFileCall: {
      count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(),
      findFirst: vi.fn(), updateMany: vi.fn(),
    },
  },
  delay: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("node:timers/promises", () => ({ setTimeout: delay }));

const channel = { id: "share", tokenHash: "token-hash", writable: true };
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  db.$transaction.mockImplementation(work => work(db));
  db.$queryRaw.mockResolvedValue([{ ...channel, seenAt: new Date() }]);
});

describe("caller timeout on the file Agent queue", () => {
  beforeEach(() => {
    db.agentFileCall.count.mockResolvedValue(0);
    db.agentFileCall.create.mockResolvedValue({ id: "job" });
    db.agentFileCall.findUnique.mockResolvedValue({ result: null });
    delay.mockImplementation(async () => vi.setSystemTime(Date.now() + 10 * 60_000));
  });

  it.each(["copy", "copy-step", "publish", "chunk", "begin", "mkdir", "rename-exclusive", "rmdir", "delete"])("retains a claimed %s while its receipt is outstanding", async op => {
    await expect(callFileAgent("node", channel, { op })).rejects.toMatchObject({ name: "BusinessError" });
    expect(db.agentFileCall.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: "job", OR: [{ claimed: false }, { result: { not: Prisma.DbNull } }] },
    });
  });

  it.each(["stat", "list", "read", "checksum"])("releases a timed-out %s immediately", async op => {
    await expect(callFileAgent("node", channel, { op })).rejects.toMatchObject({ name: "BusinessError" });
    expect(db.agentFileCall.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { id: "job" } });
  });
});

describe("file Agent claim renewal", () => {
  it("renews an expired lease on the same COPY without changing the wire operation or deadline", async () => {
    const now = Date.now();
    const operation = { op: "copy", path: "source", destination: "destination" };
    const expiresAt = new Date(now + 20_000);
    db.agentFileCall.findFirst.mockResolvedValue({ id: "job", payload: { ...operation, claimLeaseUntilMs: now }, expiresAt });
    db.agentFileCall.updateMany.mockResolvedValue({ count: 1 });

    const reply = await pollFileAgent(channel.tokenHash, "root", true, undefined, 2);

    expect(reply).toEqual({ job: { id: "job", operation, remainingMs: 20_000 } });
    expect(db.agentFileCall.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: "job", shareId: channel.id, tokenHash: channel.tokenHash,
        result: { equals: Prisma.DbNull }, expiresAt: { gt: new Date(now) },
        OR: [{ claimed: false }, { payload: { path: ["claimLeaseUntilMs"], lte: now } }],
      },
      data: { claimed: true, payload: { ...operation, claimLeaseUntilMs: now + FILE_AGENT_CLAIM_LEASE_MS } },
    });
  });

  it("withholds a delivery whose deadline passes while committing the claim", async () => {
    const expiresAt = new Date(Date.now() + 1);
    db.agentFileCall.findFirst.mockResolvedValue({ id: "job", payload: { op: "copy" }, expiresAt });
    db.agentFileCall.updateMany.mockImplementationOnce(async () => {
      vi.setSystemTime(expiresAt);
      return { count: 1 };
    });

    expect(await pollFileAgent(channel.tokenHash, "root", true, undefined, 2)).toEqual({ job: null });
  });

  it("maps an unknown receipt to UploadOutcomeUnknownError and keeps the durable write fence", async () => {
    db.agentFileCall.count.mockResolvedValue(0);
    db.agentFileCall.create.mockResolvedValue({ id: "job-unknown" });
    db.agentFileCall.findUnique.mockResolvedValue({ result: { error: "unknown" } });

    await expect(callFileAgent("node", channel, { op: "rename", path: "a", destination: "b" }))
      .rejects.toMatchObject({ name: "UploadOutcomeUnknownError" });

    db.$queryRaw.mockResolvedValueOnce([{ ...channel, serverId: "srv-1", seenAt: new Date(), rootIdentity: "root" }]);
    db.$queryRaw.mockResolvedValueOnce([]);
    db.agentFileCall.findFirst.mockResolvedValueOnce({ payload: { op: "rename" }, expiresAt: new Date(Date.now() + 30_000) });
    db.agentFileCall.updateMany.mockResolvedValueOnce({ count: 1 });
    db.agentFileCall.findFirst.mockResolvedValueOnce(null);

    await pollFileAgent(channel.tokenHash, "root", true, { id: "job-unknown", result: { error: "unknown" } }, 2);
    expect(db.setting.deleteMany).not.toHaveBeenCalled();

    db.$queryRaw.mockResolvedValueOnce([{ ...channel, serverId: "srv-1", seenAt: new Date(), rootIdentity: "root" }]);
    db.$queryRaw.mockResolvedValueOnce([]);
    db.agentFileCall.findFirst.mockResolvedValueOnce({ payload: { op: "rename" }, expiresAt: new Date(Date.now() + 30_000) });
    db.agentFileCall.updateMany.mockResolvedValueOnce({ count: 1 });
    db.agentFileCall.findFirst.mockResolvedValueOnce(null);

    await pollFileAgent(channel.tokenHash, "root", true, { id: "job-ok", result: {} }, 2);
    expect(db.setting.deleteMany).toHaveBeenCalledOnce();
  });

  it("accepts error: 'unknown' receipts through POST /api/agent/v1/files without returning 400", async () => {
    const rawToken = `vcf_${"a".repeat(20)}_${"b".repeat(64)}`;
    const tokenHash = parseFileCredential(`Bearer ${rawToken}`)!;
    db.agentFileShare.findFirst.mockResolvedValueOnce({ id: channel.id });
    db.$queryRaw.mockResolvedValueOnce([{ ...channel, tokenHash, serverId: "srv-1", seenAt: new Date(), rootIdentity: `v2:${"c".repeat(64)}` }]);
    db.$queryRaw.mockResolvedValueOnce([]);
    db.agentFileCall.findFirst.mockResolvedValueOnce({ payload: { op: "rename" }, expiresAt: new Date(Date.now() + 30_000) });
    db.agentFileCall.updateMany.mockResolvedValueOnce({ count: 1 });
    db.agentFileCall.findFirst.mockResolvedValueOnce(null);

    const response = await pollFilesRoute(
      new Request("http://127.0.0.1:3000/api/agent/v1/files", {
        method: "POST",
        headers: {
          authorization: `Bearer ${rawToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          rootIdentity: `v2:${"c".repeat(64)}`,
          writable: true,
          deliveryVersion: 2,
          receipt: { id: "job-unknown", result: { offset: 0, error: "unknown" } },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ job: null });
    expect(db.setting.deleteMany).not.toHaveBeenCalled();
  });
});
