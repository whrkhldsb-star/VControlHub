// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { getSnippet, listSnippets, type SnippetViewer } from "../service";

/**
 * A snippet not marked "visible only to me" is shared within its creator's
 * customer, and a platform administrator's with everyone. It used to be
 * listed (and readable by id) for every customer on the platform. Real
 * PostgreSQL only (relation filters on the creator).
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("shared snippets stay within their customer", () => {
  const prefix = `snip-${randomUUID().slice(0, 8)}`;
  const ids = { admin: `${prefix}-admin`, a: `${prefix}-a`, b: `${prefix}-b`, teamA: `${prefix}-team-a`, teamB: `${prefix}-team-b`, template: `${prefix}-tpl` };
  const snippets: Record<string, string> = {};
  const viewer = (userId: string, currentTeamId: string | null, platformAdmin = false): SnippetViewer => ({ userId, currentTeamId, platformAdmin });

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    const adminRole = await prisma.role.upsert({ where: { key: "admin" }, update: {}, create: { key: "admin", name: "admin" } });
    await prisma.identityTemplate.create({ data: { id: ids.template, name: prefix, permissions: ["snippet:manage"] } });
    for (const team of [ids.teamA, ids.teamB]) await prisma.team.create({ data: { id: team, slug: team, name: team } });
    await prisma.user.create({ data: { id: ids.admin, username: ids.admin, passwordHash: "x", roles: { create: { roleId: adminRole.id } } } });
    await prisma.user.create({ data: { id: ids.a, username: ids.a, passwordHash: "x", currentTeamId: ids.teamA, teamMembership: { create: { teamId: ids.teamA, identityTemplateId: ids.template } } } });
    await prisma.user.create({ data: { id: ids.b, username: ids.b, passwordHash: "x", currentTeamId: ids.teamB, teamMembership: { create: { teamId: ids.teamB, identityTemplateId: ids.template } } } });
    for (const [key, createdBy, isPrivate] of [["admin", ids.admin, false], ["a", ids.a, false], ["aPrivate", ids.a, true], ["b", ids.b, false]] as const) {
      const row = await prisma.snippet.create({ data: { title: `${prefix} ${key}`, content: key, createdBy, isPrivate } });
      snippets[key] = row.id;
    }
  });

  afterAll(async () => {
    await prisma.snippet.deleteMany({ where: { title: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.a, ids.b] } } });
    await prisma.team.deleteMany({ where: { id: { in: [ids.teamA, ids.teamB] } } });
    await prisma.identityTemplate.deleteMany({ where: { id: ids.template } });
    await prisma.$disconnect();
  });

  const titles = async (who: SnippetViewer) =>
    (await listSnippets({ viewer: who, q: prefix })).map((row) => row.title.replace(`${prefix} `, "")).sort();

  it("lists a customer's own, its colleagues' and the platform's shared snippets, not another customer's", async () => {
    expect(await titles(viewer(ids.a, ids.teamA))).toEqual(["a", "aPrivate", "admin"]);
    expect(await titles(viewer(ids.b, ids.teamB))).toEqual(["admin", "b"]);
    expect(await titles(viewer(ids.admin, null, true))).toEqual(["a", "admin", "b"]);
  });

  it("does not open another customer's shared snippet by id", async () => {
    await expect(getSnippet(snippets.b!, viewer(ids.a, ids.teamA))).rejects.toThrow();
    await expect(getSnippet(snippets.admin!, viewer(ids.a, ids.teamA))).resolves.toMatchObject({ content: "admin" });
    await expect(getSnippet(snippets.b!, viewer(ids.admin, null, true))).resolves.toMatchObject({ content: "b" });
  });
});
