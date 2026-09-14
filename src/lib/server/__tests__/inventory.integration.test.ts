// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getServerInventory, getServerOperationTargets } from "../inventory";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("server inventory PostgreSQL", () => {
  const prefix = `inventory-${randomUUID()}`;
  const session = { userId: prefix, roles: ["viewer"] as ["viewer"], currentTeamId: prefix };
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|whrkhldsb_ci/.test(db.pathname)) throw new Error("Isolated database required");
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "fixture-unused" } });
    await prisma.team.create({ data: { id: prefix, name: prefix, slug: prefix, ownerId: prefix } });
    await prisma.server.createMany({ data: Array.from({ length: 526 }, (_, i) => ({
      id: `${prefix}-${String(i).padStart(4, "0")}`, name: `${prefix}-${i}`, host: `192.0.2.${i % 255}`, port: 22,
      username: "fixture", connectionType: "PASSWORD" as const, password: "fixture-secret",
      enabled: i % 2 === 0, managementMode: i % 2 === 0 ? "DIRECT" as const : "AGENT" as const,
      tags: i === 0 ? ["生产Production%_\\"] : [], teamId: i === 525 ? null : prefix,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    })) });
  }, 30_000);
  afterAll(async () => {
    await prisma.server.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.team.deleteMany({ where: { id: prefix } });
    await prisma.user.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });
  it("paginates all 525 scoped nodes without omissions, duplicates or the old cap", async () => {
    const seen = new Set<string>();
    for (let page = 1; page <= 44; page++) {
      const result = await getServerInventory(session, { page });
      expect(result.stats).toMatchObject({ total: 525, matching: 525, enabled: 263 });
      expect(result.servers.length).toBeLessThanOrEqual(12);
      for (const row of result.servers) { expect(seen.has(row.id)).toBe(false); seen.add(row.id); expect(JSON.stringify(row)).not.toContain("fixture-secret"); }
    }
    expect(seen.size).toBe(525);
    expect((await getServerInventory(session, { page: 900 })).query.page).toBe(44);
  }, 30_000);
  it("searches tags case-insensitively with literal wildcards before combined filtering", async () => {
    for (const query of ["PRODUCTION", "%_\\", "生产"]) {
      const result = await getServerInventory(session, { query, status: "enabled", mode: "DIRECT", page: 80 });
      expect(result.stats.matching).toBe(1);
      expect(result.servers[0]?.id).toBe(`${prefix}-0000`);
      expect(result.query.page).toBe(1);
    }
    expect((await getServerInventory(session, { query: "production", status: "disabled" })).stats.matching).toBe(0);
  });
  it("quarantines unassigned servers and only returns sanitized operation targets", async () => {
    expect((await getServerInventory({ ...session, currentTeamId: null })).stats.total).toBe(0);
    const targets = await getServerOperationTargets(session, "batch");
    expect(targets.total).toBe(525);
    expect(targets.rows).toHaveLength(24);
    expect(targets.rows.some((row) => row.id.endsWith("0525"))).toBe(false);
    expect(JSON.stringify(targets)).not.toContain("fixture-secret");
    expect((await getServerOperationTargets(session, "command")).total).toBe(263);
    const seen = new Set<string>();
    for (let page = 1; page <= 22; page++) {
      const result = await getServerOperationTargets(session, "batch", { page });
      for (const row of result.rows) { expect(seen.has(row.id)).toBe(false); seen.add(row.id); }
    }
    expect(seen.size).toBe(525);
    const filtered = await getServerOperationTargets(session, "command", { query: "%_\\", page: 900 });
    expect(filtered).toMatchObject({ total: 1, page: 1 });
    expect(filtered.rows[0]?.id).toBe(`${prefix}-0000`);
  });
});
