import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { prisma } from "../src/lib/db";
import { installDirectSession } from "./helpers/direct-session";

test("live API permissions follow team switching, membership removal and role changes", async ({ browser, baseURL }) => {
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
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "admin" } });
    await prisma.user.createMany({ data: users.map((id) => ({ id, username: id, passwordHash: "fixture-not-used-for-login", status: "ACTIVE", mustChangePassword: false })) });
    await prisma.userRole.createMany({ data: users.map((userId) => ({ userId, roleId: userId === admin ? adminRole.id : viewerRole.id })) });
    await prisma.team.createMany({ data: teams.map((id) => ({ id, name: id, slug: id, ownerId: admin })) });
    await prisma.teamMember.createMany({ data: [
      { teamId: teamA, userId: member }, { teamId: teamB, userId: member },
      { teamId: teamA, userId: peerA }, { teamId: teamB, userId: peerB },
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
    const ordinary = await contextFor(member);
    const manager = await contextFor(admin);
    const checkScope = async (context: APIRequestContext, visibleTeam: string | null, global = false) => {
      for (const id of teams) {
        for (const path of [`/api/servers/${id}/uptime`, `/api/jobs/${id}/events`]) {
          const response = await context.get(path);
          expect(response.status(), path).toBe(global || id === visibleTeam ? 200 : 404);
          if (response.status() === 404) expect(await response.text()).not.toContain(`${id}-event`);
        }
      }
      const response = await context.get("/api/users?pageSize=100");
      expect(response.ok()).toBe(true);
      const body = await response.json();
      const ids = (body.users as { id: string }[]).map((user) => user.id);
      expect(ids).toContain(global ? admin : member);
      if (!global) {
        expect(ids.includes(peerA)).toBe(visibleTeam === teamA);
        expect(ids.includes(peerB)).toBe(visibleTeam === teamB);
        expect(ids).not.toContain(admin);
      }
    };
    await test.step("member sees current team and global admin sees all teams", async () => {
      await checkScope(ordinary, teamA);
      await checkScope(manager, null, true);
      expect((await ordinary.post("/api/ai/providers", { data: {} })).status()).toBe(403);
    });
    await test.step("same signed session follows an authorized team switch", async () => {
      expect((await ordinary.post("/api/teams/switch", { data: { teamId: teamB } })).status()).toBe(200);
      await checkScope(ordinary, teamB);
      expect((await ordinary.post("/api/teams/switch", { data: { teamId: outside } })).status()).toBe(403);
      await checkScope(ordinary, teamB);
    });
    await test.step("revoked membership invalidates the current workspace immediately", async () => {
      await prisma.teamMember.delete({ where: { teamId_userId: { teamId: teamB, userId: member } } });
      await checkScope(ordinary, null);
    });
    await test.step("role removal invalidates global access despite the old signed admin claim", async () => {
      await prisma.userRole.deleteMany({ where: { userId: admin } });
      await prisma.userRole.create({ data: { userId: admin, roleId: viewerRole.id } });
      for (const id of teams) {
        expect((await manager.get(`/api/jobs/${id}/events`)).status()).toBe(404);
        expect((await manager.get(`/api/servers/${id}/uptime`)).status()).toBe(404);
      }
      expect((await manager.post("/api/ai/providers", { data: {} })).status()).toBe(403);
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await prisma.job.deleteMany({ where: { type: prefix } });
    await prisma.server.deleteMany({ where: { id: { in: teams } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.team.deleteMany({ where: { id: { in: teams } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
});
