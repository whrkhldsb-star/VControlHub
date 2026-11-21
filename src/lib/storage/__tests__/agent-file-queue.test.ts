import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callFileAgent, FILE_AGENT_CLAIM_LEASE_MS, pollFileAgent } from "../agent-file-queue";

const { db, delay } = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
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
});
