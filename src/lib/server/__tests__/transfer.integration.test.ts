// @vitest-environment node
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
  const transfer = () => transferServerToCustomer(id, newTeam, actor);

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
    await prisma.server.deleteMany({ where: { id } });
    await prisma.auditLog.deleteMany({ where: { actorId: id } });
    await prisma.user.deleteMany({ where: { id } });
    await prisma.team.deleteMany({ where: { id: { in: [oldTeam, newTeam] } } });
    await prisma.$disconnect();
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
    await completeServerAgentJob({ serverId: id, jobId: job!.id, exitCode: 130 });
    await expect(pending).resolves.toMatchObject({ cancelled: true });

    const proxy = await prisma.serverFileProxy.create({ data: {
      serverId: id, port: 8080, status: "stopped", pid: 123, accessToken: "fixture", expiresAt: new Date(0),
    } });
    await expect(transfer()).rejects.toThrow();
    await prisma.serverFileProxy.update({ where: { id: proxy.id }, data: { pid: null, accessToken: null, expiresAt: null } });
    await transfer();
    await expect(prisma.server.findUnique({ where: { id } })).resolves.toMatchObject({
      teamId: newTeam, agentTokenHash: null, directGatewayKeyVersion: 4,
    });
    await expect(executeCommandWithAgent(jobInput)).resolves.toBeNull();
  });
});
