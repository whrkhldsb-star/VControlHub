// @vitest-environment node
// Uses only a disposable audit database. All SSH/Agent transports are mocked.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ ssh: vi.fn() }));
vi.mock("@/lib/command/service-ssh", () => ({
  executeCommandOverSsh: state.ssh,
  getCommandRuntimeConfigValues: async () => ({ executionTimeoutMs: 1000, outputLimitBytes: 4096 }),
  setPasswordExecutorMode: vi.fn(), shouldUseSsh2PasswordExecutor: () => false,
}));
vi.mock("@/lib/server/agent-service", () => ({ executeCommandWithAgent: vi.fn() }));
vi.mock("@/lib/audit/service", () => ({ auditSystemAction: vi.fn() }));
vi.mock("@/lib/notification/service", () => ({ notifyCommandResult: async () => undefined }));
vi.mock("@/lib/ssh/ssh-key-crypto", async () => (await import("@/test/ssh-key-crypto-mock")).withStoredKeyHelpers({ decryptServerPassword: (v: string) => v, decryptSshPrivateKey: (v: string) => v }));

import { prisma } from "@/lib/db";
import { assertRequesterMayExecuteCommand } from "@/lib/auth/command-execution-authz";
import { executeTargets } from "../service-execution";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("queued command execution revocation", () => {
  const created: Array<{ user: string; team: string; server: string; request: string }> = [];
  afterEach(async () => {
    for (const fixture of created.splice(0)) {
      await prisma.commandRequest.deleteMany({ where: { id: fixture.request } });
      await prisma.server.deleteMany({ where: { id: fixture.server } });
      await prisma.user.deleteMany({ where: { id: fixture.user } });
      await prisma.team.deleteMany({ where: { id: fixture.team } });
    }
    state.ssh.mockClear();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it.each(["disabled-user", "removed-membership", "disabled-node"])("refuses dispatch after %s", async (revocation) => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("This regression requires an isolated loopback audit/test database");
    }
    const prefix = `vch-authz-audit-${randomUUID()}`;
    const fixture = { user: prefix, team: prefix, server: prefix, request: prefix };
    created.push(fixture);
    await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash", status: "ACTIVE", mustChangePassword: false, currentTeamId: prefix,
      teamMemberships: { create: { teamId: prefix, role: "owner", accessRole: "inherit" } } } });
    await prisma.server.create({ data: { id: prefix, name: prefix, host: "192.0.2.5", username: "audit", tags: [], teamId: prefix, connectionType: "PASSWORD", password: "audit-only", hostKeySha256: "SHA256:audit-only" } });
    await prisma.commandRequest.create({ data: { id: prefix, title: "Audit harmless command", command: "printf audit", requesterId: prefix, teamId: prefix, initiatedByType: "USER", status: "APPROVED",
      targets: { create: { id: prefix, serverId: prefix, status: "APPROVED" } } } });
    expect(await assertRequesterMayExecuteCommand(prefix, prefix)).toEqual({ ok: true });
    if (revocation === "disabled-user") await prisma.user.update({ where: { id: prefix }, data: { status: "DISABLED" } });
    if (revocation === "removed-membership") await prisma.teamMember.delete({ where: { teamId_userId: { teamId: prefix, userId: prefix } } });
    if (revocation === "disabled-node") await prisma.server.update({ where: { id: prefix }, data: { enabled: false } });
    if (revocation !== "disabled-node") expect((await assertRequesterMayExecuteCommand(prefix, prefix)).ok).toBe(false);
    state.ssh.mockResolvedValue({ stdout: "audit", stderr: "", exitCode: 0 });
    await executeTargets(prefix);
    expect(state.ssh).not.toHaveBeenCalled();
    expect(await prisma.commandTarget.findUnique({ where: { id: prefix }, select: { status: true } })).toEqual({ status: "FAILED" });
  });
});
