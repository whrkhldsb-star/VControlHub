// @vitest-environment node
import { PassThrough } from "node:stream";
import { getLockKeys } from "@/lib/concurrency/advisory-lock";
import { fileWriteFence, pollFileAgent } from "@/lib/storage/agent-file-queue";
import { holdServerLockForDownload, withServerLifecycleLock } from "../lifecycle-lock";
import { closeTerminalRegistry, registerTerminalSession } from "../terminal-handover";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { claimNextServerAgentJob, completeServerAgentJob, executeCommandWithAgent } from "../agent-service";
import { transferServerToCustomer } from "../transfer";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("handover with outstanding Agent and proxy access", () => {
  const id = `transfer-${randomUUID()}`;
  const oldTeam = id + "-old";
  const newTeam = id + "-new";
  const tokenHash = "12".repeat(32);
  const actor: SessionPayload = { userId: id, username: id, currentTeamId: null, roles: ["admin"], mustChangePassword: false };
  const transfer = () => transferServerToCustomer(id, newTeam, actor, { previousTeamId: oldTeam, credentialsRotated: true });

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback test database");
    }
    await prisma.team.createMany({ data: [oldTeam, newTeam].map(team => ({ id: team, name: team, slug: team })) });
    await prisma.user.create({ data: { id, username: id, passwordHash: "unused" } });
    await prisma.server.create({ data: {
      id, name: id, host: id + ".test", username: "ops", teamId: oldTeam, managementMode: "AGENT",
      agentTokenHash: tokenHash, agentLastSeenAt: new Date(), directGatewayKeyVersion: 3,
    } });
  });

  afterAll(async () => {
    await closeTerminalRegistry();
    await prisma.storageNode.deleteMany({ where: { id } });
    await prisma.setting.deleteMany({ where: { key: { startsWith: fileWriteFence(id) } } });
    await prisma.server.deleteMany({ where: { id } });
    await prisma.auditLog.deleteMany({ where: { actorId: id } });
    await prisma.user.deleteMany({ where: { id } });
    await prisma.team.deleteMany({ where: { id: { in: [oldTeam, newTeam] } } });
    await prisma.$disconnect();
  });

  it("requires a terminal receipt even if the transport has lost its unlogged call", async () => {
    const hash = "34".repeat(32);
    await prisma.storageNode.create({ data: { id, name: id, teamId: oldTeam, driver: "AGENT", basePath: "/",
      agentFileShare: { create: { id, serverId: id, teamId: oldTeam, tokenHash: hash, agentHash: tokenHash } } } });
    const call = await prisma.agentFileCall.create({ data: { shareId: id, tokenHash: hash, payload: { op: "mkdir", path: "work" }, expiresAt: new Date(Date.now() + 60000) } });
    expect(await pollFileAgent(hash, "fixture-root", false)).toEqual({ job: null });
    expect(await pollFileAgent(hash, "fixture-root", true)).toMatchObject({ job: { id: call.id } });
    await prisma.agentFileCall.delete({ where: { id: call.id } });
    await expect(transfer()).rejects.toThrow();
    await pollFileAgent(hash, "fixture-root", true, { id: call.id, result: { offset: 0 } });
    expect(await prisma.setting.count({ where: { key: fileWriteFence(id, call.id) } })).toBe(0);
  });

  it("requires the Agent's acknowledgement and a confirmed proxy stop before changing customers", async () => {
    const jobInput = { serverId: id, command: "fixture", timeoutMs: 2000, expectedIdentity: { tokenHash, teamId: oldTeam } };
    const pending = executeCommandWithAgent(jobInput);
    await expect.poll(() => prisma.serverAgentJob.count({ where: { serverId: id, status: "PENDING" } })).toBe(1);
    const job = await claimNextServerAgentJob(id, tokenHash);
    expect(job).toBeTruthy();
    await expect(transfer()).rejects.toThrow();
    await prisma.serverAgentJob.update({ where: { id: job!.id }, data: { status: "CANCELLED" } });
    await expect(transfer()).rejects.toThrow();
    await completeServerAgentJob({ serverId: id, agentTokenHash: tokenHash, jobId: job!.id, exitCode: 130 });
    await expect(pending).resolves.toMatchObject({ cancelled: true });

    const proxy = await prisma.serverFileProxy.create({ data: {
      serverId: id, port: 8080, status: "stopped", pid: 123, accessToken: "fixture", expiresAt: new Date(0),
    } });
    await expect(transfer()).rejects.toThrow();
    await prisma.serverFileProxy.update({ where: { id: proxy.id }, data: { pid: null, accessToken: null, expiresAt: null } });
    const orphan = fileWriteFence(id, "orphan");
    await prisma.setting.create({ data: { key: orphan, value: "unreachable-agent" } });
    await expect(transfer()).rejects.toThrow();
    const closures = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const release = await Promise.all(closures.map(done => registerTerminalSession(id, done.resolve)));
    const stream = new PassThrough();
    await withServerLifecycleLock(id, () => withServerLifecycleLock(id, async () => holdServerLockForDownload(stream)));
    const handover = transferServerToCustomer(id, newTeam, actor, { credentialsRotated: true, previousTeamId: oldTeam, fileAgentStopped: true });
    try {
      const { k1, k2 } = getLockKeys("server-delete", id);
      await expect.poll(async () => {
        const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS(SELECT FROM pg_locks WHERE locktype='advisory' AND NOT granted AND classid = ${k1 >>> 0}::oid AND objid = ${k2 >>> 0}::oid) AS waiting`;
        return row?.waiting;
      }).toBe(true);
      stream.destroy();
      await Promise.all(closures.map(done => done.promise));
      release[0]!();
      expect((await prisma.server.findUniqueOrThrow({ where: { id } })).teamId).toBe(oldTeam);
    } finally {
      stream.destroy();
      release.forEach(unlock => unlock());
      await handover;
    }
    await expect(prisma.server.findUnique({ where: { id } })).resolves.toMatchObject({
      teamId: newTeam, agentTokenHash: null, directGatewayKeyVersion: 4,
    });
    await expect(executeCommandWithAgent(jobInput)).resolves.toBeNull();
  });
});
