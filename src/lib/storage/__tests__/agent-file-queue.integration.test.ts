// @vitest-environment node
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/agent/v1/files/route";
import { prisma } from "@/lib/db";
import { callFileAgent, FILE_AGENT_CLAIM_LEASE_MS, FILE_AGENT_RECEIPT_GRACE_MS, getFileChannel, sweepExpiredFileAgentCalls } from "../agent-file-queue";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("durable file Agent delivery (PostgreSQL)", () => {
  const id = randomUUID().replaceAll("-", "");
  const token = `vcf_${id}_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rootIdentity = "v2:" + tokenHash;
  const copy = { op: "copy", path: "source", destination: "destination" };
  // Keep the simulated sweep behind real time so it cannot expire another suite's active calls.
  const start = Date.UTC(2025, 0, 1);
  const calls = prisma.agentFileCall;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback test database");
    }
    await prisma.server.create({ data: { id, name: id, host: "files.invalid", username: "fixture", managementMode: "AGENT", agentTokenHash: id } });
    await prisma.storageNode.create({ data: {
      id, name: id, driver: "AGENT", basePath: "/",
      agentFileShare: { create: { id, serverId: id, tokenHash, agentHash: id, rootIdentity, writable: true } },
    } });
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    await prisma.agentFileShare.update({ where: { id }, data: { seenAt: new Date(), lastWriteAt: null } });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await calls.deleteMany({ where: { shareId: id } });
  });
  afterAll(async () => {
    await prisma.storageNode.deleteMany({ where: { id } });
    await prisma.server.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });

  async function poll(deliveryVersion: number | undefined, receipt?: { id: string; result: { offset: number; error?: string } }) {
    const res = await POST(new Request("https://hub.test/api/agent/v1/files", {
      method: "POST", headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ rootIdentity, writable: true, deliveryVersion, receipt }),
    }));
    expect(res.status).toBe(200);
    return (await res.json()).job as { id: string; remainingMs: number; operation: typeof copy } | null;
  }
  const enqueue = (expiresAt: Date, op = "copy", claimed = false) => calls.create({
    data: { shareId: id, tokenHash, payload: { ...copy, op }, expiresAt, claimed },
  });

  it("reconciles a late COPY receipt after the caller and original agent deadline expire", async () => {
    const timedOut = expect(callFileAgent(id, await getFileChannel(id), copy)).rejects.toMatchObject({ name: "BusinessError" });
    const call = await vi.waitFor(() => calls.findFirstOrThrow({ where: { shareId: id } }));
    expect(await poll(2)).toMatchObject({ id: call.id, operation: copy });
    vi.setSystemTime(call.expiresAt);
    await timedOut;
    await sweepExpiredFileAgentCalls();
    expect(await calls.findUnique({ where: { id: call.id } })).toMatchObject({ claimed: true, result: null });
    vi.setSystemTime(call.expiresAt.getTime() + FILE_AGENT_RECEIPT_GRACE_MS - 1);
    expect(await poll(2)).toBeNull();
    expect(await poll(2, { id: call.id, result: { offset: 0 } })).toBeNull();
    expect(await calls.findUnique({ where: { id: call.id } })).toMatchObject({ payload: {}, result: { offset: 0 } });
    expect((await prisma.agentFileShare.findUniqueOrThrow({ where: { id } })).lastWriteAt).toEqual(new Date());
    await sweepExpiredFileAgentCalls();
    expect(await calls.findUnique({ where: { id: call.id } })).toBeNull();
  });

  it("redelivers a lost v2 claim once per lease with the same ID and deadline, and completes only once", async () => {
    const deadline = start + 45_000;
    const call = await enqueue(new Date(deadline));
    expect(await poll(2)).toEqual({ id: call.id, operation: copy, remainingMs: deadline - start });
    vi.setSystemTime(start + FILE_AGENT_CLAIM_LEASE_MS - 1);
    expect(await poll(2)).toBeNull();
    vi.setSystemTime(start + FILE_AGENT_CLAIM_LEASE_MS);
    expect(await poll(undefined)).toBeNull();
    const redeliveries = await Promise.all([poll(2), poll(2)]);
    expect(redeliveries.filter(Boolean)).toEqual([{ id: call.id, operation: copy, remainingMs: deadline - Date.now() }]);
    const receivedAt = new Date();
    expect(await poll(2, { id: call.id, result: { offset: 0 } })).toBeNull();
    vi.setSystemTime(start + 2 * FILE_AGENT_CLAIM_LEASE_MS);
    expect(await poll(2, { id: call.id, result: { offset: 1, error: "io" } })).toBeNull();
    expect(await calls.findUnique({ where: { id: call.id } })).toMatchObject({ result: { offset: 0 }, payload: {}, expiresAt: new Date(deadline) });
    expect((await prisma.agentFileShare.findUniqueOrThrow({ where: { id } })).lastWriteAt).toEqual(receivedAt);
  });

  it("accepts a legacy claim's receipt after upgrade without repeating its write", async () => {
    const call = await enqueue(new Date(start + 45_000));
    expect(await poll(undefined)).toMatchObject({ id: call.id });
    vi.setSystemTime(start + FILE_AGENT_CLAIM_LEASE_MS);
    expect(await poll(2)).toBeNull();
    vi.setSystemTime(start + 45_000);
    expect(await poll(2, { id: call.id, result: { offset: 0 } })).toBeNull();
    expect((await calls.findUniqueOrThrow({ where: { id: call.id } })).result).toEqual({ offset: 0 });
  });

  it("sweeps unclaimed, read and completed rows at the deadline and unknown writes exactly at the grace boundary", async () => {
    const deadline = new Date(start);
    const unknown = await Promise.all(["copy", "publish", "copy-step", "rename", "chunk"].map(op => enqueue(deadline, op, true)));
    await enqueue(deadline);
    const read = await enqueue(deadline, "stat", true);
    const completed = await enqueue(deadline, "copy", true);
    await calls.update({ where: { id: completed.id }, data: { result: { offset: 0 }, payload: {} } });
    const live = await enqueue(new Date(start + FILE_AGENT_RECEIPT_GRACE_MS + 1));
    const remaining = async () => (await calls.findMany({ where: { shareId: id }, select: { id: true } })).map(row => row.id).sort();

    await poll(2, { id: read.id, result: { offset: 0 } });
    expect((await calls.findUniqueOrThrow({ where: { id: read.id } })).result).toBeNull();
    await sweepExpiredFileAgentCalls();
    const retained = [...unknown, live].map(row => row.id).sort();
    expect(await remaining()).toEqual(retained);
    vi.setSystemTime(start + FILE_AGENT_RECEIPT_GRACE_MS - 1);
    await sweepExpiredFileAgentCalls();
    expect(await remaining()).toEqual(retained);
    vi.setSystemTime(start + FILE_AGENT_RECEIPT_GRACE_MS);
    await poll(2, { id: unknown[0]!.id, result: { offset: 0 } });
    expect((await calls.findUniqueOrThrow({ where: { id: unknown[0]!.id } })).result).toBeNull();
    await sweepExpiredFileAgentCalls();
    expect(await remaining()).toEqual([live.id]);
  });
});
