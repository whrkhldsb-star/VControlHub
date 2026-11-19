// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { execRemoteCommand } from "@/lib/ssh/client";
import { authenticateServerAgent, claimNextServerAgentJob, issueServerAgentToken, updateServerAgentHeartbeat } from "../agent-service";
import { updateServerProfile } from "../service-profiles";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ssh/client", async (original) => ({
  ...await original<typeof import("@/lib/ssh/client")>(),
  execRemoteCommand: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
}));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("management mode changes (PostgreSQL)", () => {
  const prefix = `mode-${randomUUID()}`;
  beforeAll(() => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("requires a local test database");
  });
  afterAll(async () => {
    await prisma.server.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  it("verifies new Linux credentials before retiring the old identity and its jobs", async () => {
    const id = prefix + "-linux";
    await prisma.server.create({ data: { id, name: id, host: id + ".test", username: "ops", connectionType: "PASSWORD", password: "retained",
      hostKeySha256: "SHA256:fixture", managementMode: "AGENT", enabled: false } });
    const old = await issueServerAgentToken(id);
    const identity = (await authenticateServerAgent(old))!;
    await updateServerAgentHeartbeat({ serverId: id, agentTokenHash: identity.agentTokenHash, version: "old" });
    const queued = await prisma.serverAgentJob.create({ data: { serverId: id, command: "fixture" } });
    const running = await prisma.serverAgentJob.create({ data: { serverId: id, command: "fixture", status: "CLAIMED" } });
    await expect(updateServerProfile(id, { managementMode: "DIRECT" })).rejects.toThrow(/SSH/);
    vi.mocked(execRemoteCommand).mockRejectedValueOnce(new Error("fixture login refused"));
    await expect(updateServerProfile(id, { managementMode: "DIRECT", password: "incorrect" })).rejects.toThrow(/fixture login refused/);
    expect(await authenticateServerAgent(old)).toBeTruthy();
    expect((await prisma.serverAgentJob.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("PENDING");

    const direct = await updateServerProfile(id, { managementMode: "DIRECT", password: "new credential" });
    expect(direct.agent).toMatchObject({ online: false, version: null, capabilities: [] });
    expect(await authenticateServerAgent(old)).toBeNull();
    expect(await prisma.serverAgentJob.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: "CANCELLED", completedAt: expect.any(Date) });
    expect(await prisma.serverAgentJob.findUniqueOrThrow({ where: { id: running.id } })).toMatchObject({ status: "CANCELLED", completedAt: null });
    await expect(issueServerAgentToken(id)).rejects.toThrow();

    await expect(updateServerProfile(id, { managementMode: "AGENT" })).rejects.toThrow(/SSH/);
    await updateServerProfile(id, { managementMode: "AGENT", password: "new credential" });
    expect(await authenticateServerAgent(old)).toBeNull();
    const fresh = await issueServerAgentToken(id);
    expect(await authenticateServerAgent(fresh)).toBeTruthy();
    expect(await updateServerAgentHeartbeat({ serverId: id, agentTokenHash: identity.agentTokenHash, version: "old" })).toBe(false);
    const next = await prisma.serverAgentJob.create({ data: { serverId: id, command: "fixture" } });
    expect(await claimNextServerAgentJob(id, identity.agentTokenHash)).toBeNull();
    expect((await claimNextServerAgentJob(id, (await authenticateServerAgent(fresh))!.agentTokenHash))?.id).toBe(next.id);
  });

  it("retires the previous identity when the Agent address changes in the same mode", async () => {
    for (const operatingSystem of ["LINUX", "WINDOWS"] as const) {
      const id = prefix + "-move-" + operatingSystem;
      // Inventory tests populate 192.0.2.0/24 in this database. Linux accepts a
      // unique hostname; the Windows RDP schema requires a literal IPv4 address.
      const host = operatingSystem === "LINUX" ? id.toLowerCase() + ".test" : "203.0.113.217";
      await prisma.server.create({ data: { id, name: id, host, port: operatingSystem === "LINUX" ? 22 : 3389,
        operatingSystem, username: "ops", managementMode: "AGENT", enabled: false, connectionType: "PASSWORD", password: "old", rdpPassword: "old" } });
      const token = await issueServerAgentToken(id);
      const pending = await prisma.serverAgentJob.create({ data: { serverId: id, command: "fixture" } });
      await updateServerProfile(id, operatingSystem === "WINDOWS"
        ? { host: "203.0.113.219", rdpPassword: "new" }
        : { port: 2222, password: "new", approvedHostKeySha256: "SHA256:fixture" });
      expect(await authenticateServerAgent(token)).toBeNull();
      expect(await prisma.serverAgentJob.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "CANCELLED" });
    }
  });

  it("revokes an offline Windows Agent while preserving its separate SFTP binding", async () => {
    const id = prefix + "-windows";
    await prisma.server.create({ data: { id, name: "Windows fixture", host: "203.0.113.218", port: 3389, username: "Admin", operatingSystem: "WINDOWS",
      connectionType: "PASSWORD", password: "sftp fixture", rdpPassword: "retained", managementMode: "AGENT" } });
    await prisma.storageNode.create({ data: { serverId: id, name: id, driver: "SFTP", basePath: "/C:/files", port: 2222, username: "files" } });
    const old = await issueServerAgentToken(id);
    await expect(updateServerProfile(id, { managementMode: "DIRECT" })).rejects.toThrow();
    expect(await authenticateServerAgent(old)).toBeTruthy();
    const direct = await updateServerProfile(id, { managementMode: "DIRECT", rdpPassword: "new RDP fixture" });
    expect(direct.onboardingWarnings.join(" ")).toMatch(/Agent/i);
    expect(await authenticateServerAgent(old)).toBeNull();
    const agent = await updateServerProfile(id, { managementMode: "AGENT" });
    expect(agent.agent.online).toBe(false);
    const row = await prisma.server.findUniqueOrThrow({ where: { id }, include: { storageNode: true } });
    expect(row).toMatchObject({ agentTokenHash: null, password: "sftp fixture", storageNode: { port: 2222, username: "files" } });
  });
});
