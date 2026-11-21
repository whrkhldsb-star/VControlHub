// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth/session";
import { setCustomerMembership } from "@/lib/team/service";

const state = vi.hoisted(() => ({ hash: vi.fn(), session: null as SessionPayload | null }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: state.hash }));
vi.mock("@/lib/auth/password-policy", () => ({ validatePasswordPolicy: async () => null }));
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: async (request: Request, _options: unknown, handler: (ctx: unknown) => Promise<Response>) =>
    handler({ session: state.session, body: await request.json() }),
}));

const { PATCH } = await import("../route");

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("user status changes during a password reset (PostgreSQL)", () => {
  const id = `reset-disable-${randomUUID()}`;
  const adminId = id + "-admin";
  const source = id + "-source";
  const destination = id + "-destination";
  let ready = false;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("Disposable database required");
    }
    await prisma.$transaction(async tx => {
      await tx.team.createMany({ data: [source, destination].map(key => ({ id: key, slug: key, name: key })) });
      await tx.identityTemplate.create({ data: { id, name: id, permissions: [] } });
      await tx.user.createMany({ data: [id, adminId].map(key => ({
        id: key, username: key, passwordHash: "old-hash", status: "ACTIVE", mustChangePassword: false,
      })) });
      await tx.teamMember.create({ data: { teamId: source, userId: id, identityTemplateId: id } });
    });
    state.session = { userId: adminId, username: adminId, roles: ["admin"], currentTeamId: source, mustChangePassword: false };
    ready = true;
  });

  afterAll(async () => {
    if (ready) {
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
      await prisma.user.deleteMany({ where: { id: { in: [id, adminId] } } });
      await prisma.identityTemplate.delete({ where: { id } });
      await prisma.team.deleteMany({ where: { id: { in: [source, destination] } } });
    }
    await prisma.$disconnect();
  });

  it("preserves a concurrent disable and audits the password reset in the customer's new team", async () => {
    const hashing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<string>();
    state.hash.mockImplementation(() => { hashing.resolve(); return release.promise; });
    const request = (action: string) => new Request("http://local/api/users", {
      method: "PATCH", body: JSON.stringify({ userId: id, action, newPassword: "test-only" }),
    });
    const reset = PATCH(request("reset_password"));
    await hashing.promise;
    try {
      expect((await PATCH(request("disable"))).status).toBe(200);
      await setCustomerMembership({ userId: id, teamId: destination, identityTemplateId: id }, state.session!);
    } finally {
      release.resolve("new-test-hash");
    }
    expect((await reset).status).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "DISABLED", passwordHash: "new-test-hash", mustChangePassword: true,
    });
    expect(await prisma.auditLog.findMany({
      where: { actorId: adminId, action: { in: ["user.disable", "user.password_reset"] } },
      select: { action: true, teamId: true }, orderBy: { action: "asc" },
    })).toEqual([{ action: "user.disable", teamId: source }, { action: "user.password_reset", teamId: destination }]);
  });
});
