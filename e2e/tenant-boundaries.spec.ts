import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { prisma } from "../src/lib/db";
import { installDirectSession } from "./helpers/direct-session";

test("live API permissions follow customer selection, membership moves and role changes", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const database = new URL(process.env.DATABASE_URL!);
  const dedicatedDatabase = /audit|test/.test(database.pathname) || (process.env.CI === "true" && /_ci$/.test(database.pathname));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || !dedicatedDatabase) {
    throw new Error("Tenant regression requires a loopback audit/test database");
  }
  const prefix = `tenant-audit-${randomUUID()}`;
  const users = ["member", "peer-a", "peer-b", "admin"].map((suffix) => `${prefix}-${suffix}`);
  const [member, peerA, peerB, admin] = users as [string, string, string, string];
  const teams = ["a", "b", "outside"].map((suffix) => `${prefix}-${suffix}`);
  const [teamA, teamB, outside] = teams as [string, string, string];
  const contexts: BrowserContext[] = [];
  try {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "admin" } });
    await prisma.user.createMany({ data: users.map((id) => ({ id, username: id, passwordHash: "fixture-not-used-for-login", status: "ACTIVE", mustChangePassword: false })) });
    await prisma.userRole.create({ data: { userId: admin, roleId: adminRole.id } });
    await prisma.team.createMany({ data: teams.map((id) => ({ id, name: id, slug: id })) });
    await prisma.teamMember.createMany({ data: [
      { teamId: teamA, userId: member, identityTemplateId: "identity:operator" },
      { teamId: teamA, userId: peerA, identityTemplateId: "identity:viewer" },
      { teamId: teamB, userId: peerB, identityTemplateId: "identity:viewer" },
    ] });
    await prisma.user.update({ where: { id: member }, data: { currentTeamId: teamA } });
    await prisma.server.createMany({ data: teams.map((teamId) => ({ id: teamId, teamId, name: teamId, host: "192.0.2.1", port: 22, username: "fixture", connectionType: "PASSWORD", enabled: false })) });
    await prisma.job.createMany({ data: teams.map((teamId) => ({ id: teamId, teamId, type: prefix, title: teamId, createdBy: member, status: "COMPLETED", payload: {} })) });
    await prisma.jobEvent.createMany({ data: teams.map((id) => ({ jobId: id, type: "completed", message: `${id}-event` })) });

    const contextFor = async (userId: string) => {
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      await installDirectSession(context, { username: userId });
      const csrf = (await context.cookies()).find((cookie) => cookie.name === "csrf_token")!.value;
      await context.setExtraHTTPHeaders({ "X-CSRF-Token": csrf });
      return context.request;
    };
    const customer = await contextFor(member);
    const secondBrowser = await contextFor(member);
    const manager = await contextFor(admin);
    /** `visible`: the one customer whose rows are reachable, or "all". */
    const checkScope = async (context: APIRequestContext, visible: string | null | "all") => {
      for (const id of teams) {
        for (const path of [`/api/servers/${id}/uptime`, `/api/jobs/${id}/events`]) {
          const response = await context.get(path);
          if (visible === "all" || id === visible) {
            expect(response.status(), path).toBe(200);
          } else {
            expect([403, 404], path).toContain(response.status());
            expect(await response.text()).not.toContain(`${id}-event`);
          }
        }
      }
    };
    const directory = async (context: APIRequestContext) => {
      const response = await context.get("/api/users?pageSize=100");
      expect(response.ok()).toBe(true);
      return ((await response.json()).users as { id: string }[]).map((user) => user.id);
    };

    await test.step("a customer account sees only its customer and cannot switch", async () => {
      await checkScope(customer, teamA);
      const ids = await directory(customer);
      expect(ids).toEqual(expect.arrayContaining([member, peerA]));
      expect(ids).not.toContain(peerB);
      expect(ids).not.toContain(admin);
      expect((await customer.post("/api/teams/switch", { data: { teamId: teamB } })).status()).toBe(403);
      // Customers and accounts are platform-only, whatever the template grants.
      expect((await customer.post("/api/teams", { data: { name: `${prefix}-x` } })).status()).toBe(403);
      expect((await customer.post("/api/users", { data: {} })).status()).toBe(403);
    });

    await test.step("an administrator sees all customers, or only the one it selects", async () => {
      expect((await manager.post("/api/teams/switch", { data: { teamId: null } })).status()).toBe(200);
      await checkScope(manager, "all");
      expect((await manager.post("/api/teams/switch", { data: { teamId: outside } })).status()).toBe(200);
      expect((await (await manager.get("/api/teams")).json()).currentTeamId).toBe(outside);
      await checkScope(manager, outside);
    });

    await test.step("moving the account to another customer applies to every browser at once", async () => {
      expect((await manager.post(`/api/teams/${teamB}/members`, { data: { userId: member, identityTemplateId: "identity:operator" } })).status()).toBe(200);
      await checkScope(customer, teamB);
      await checkScope(secondBrowser, teamB);
    });

    await test.step("removing the membership revokes the customer immediately", async () => {
      expect((await manager.delete(`/api/teams/${teamB}/members/${member}`)).status()).toBe(200);
      await checkScope(customer, null);
      expect(await directory(customer)).toEqual([member]);
    });

    await test.step("removing the admin role revokes access despite the old signed claim", async () => {
      await prisma.userRole.deleteMany({ where: { userId: admin } });
      for (const id of teams) {
        expect([403, 404]).toContain((await manager.get(`/api/jobs/${id}/events`)).status());
        expect([403, 404]).toContain((await manager.get(`/api/servers/${id}/uptime`)).status());
      }
      expect((await manager.post("/api/ai/providers", { data: {} })).status()).toBe(403);
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await prisma.job.deleteMany({ where: { type: prefix } });
    await prisma.server.deleteMany({ where: { id: { in: teams } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.teamMember.deleteMany({ where: { userId: { in: users } } });
    await prisma.team.deleteMany({ where: { id: { in: teams } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
});
