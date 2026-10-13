// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { listShareLinkPage } from "../service";

/**
 * 205 shares in one customer: the oldest is still active. It used to fall off
 * the fixed 200-row list; it must stay reachable by paging and by filters, and
 * the reported total must be the real count. Real PostgreSQL only.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("share list pagination", () => {
  const prefix = `share-page-${randomUUID()}`;
  const session = { userId: prefix, roles: ["operator" as const], currentTeamId: prefix };

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "not-a-login-hash" } });
    await prisma.storageNode.create({ data: { id: prefix, name: prefix, driver: "LOCAL", basePath: "/nonexistent-share-fixture", teamId: prefix } });
    const base = Date.parse("2026-01-01T00:00:00Z");
    await prisma.shareLink.createMany({
      data: Array.from({ length: 205 }, (_, index) => ({
        tokenHash: `${prefix}-${index}`,
        storageNodeId: prefix,
        path: index === 0 ? "contracts/oldest-still-active.pdf" : `bulk/file-${index}.txt`,
        createdBy: prefix,
        teamId: prefix,
        createdAt: new Date(base + index * 60_000),
        // Everything newer than the oldest share is already revoked.
        revokedAt: index === 0 ? null : new Date(base + index * 60_000 + 1),
      })),
    });
  });

  afterAll(async () => {
    await prisma.shareLink.deleteMany({ where: { teamId: prefix } });
    await prisma.storageNode.deleteMany({ where: { id: prefix } });
    await prisma.user.deleteMany({ where: { id: prefix } });
    await prisma.team.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  it("reports the real total and reaches the oldest share on the last page", async () => {
    const first = await listShareLinkPage(session, { pageSize: 50 });
    expect(first.total).toBe(205);
    expect(first.shares).toHaveLength(50);
    expect(first.shares.map((share) => share.path)).not.toContain("contracts/oldest-still-active.pdf");

    const last = await listShareLinkPage(session, { pageSize: 50, page: 5 });
    expect(last.shares).toHaveLength(5);
    expect(last.shares.at(-1)?.path).toBe("contracts/oldest-still-active.pdf");

    const seen = new Set<string>();
    for (let page = 1; page <= 5; page += 1) {
      for (const share of (await listShareLinkPage(session, { pageSize: 50, page })).shares) seen.add(share.id);
    }
    expect(seen.size).toBe(205);
  });

  it("filters by status and search before paging", async () => {
    const active = await listShareLinkPage(session, { status: "active" });
    expect(active.total).toBe(1);
    expect(active.shares[0]?.path).toBe("contracts/oldest-still-active.pdf");

    const revoked = await listShareLinkPage(session, { status: "revoked", pageSize: 10 });
    expect(revoked.total).toBe(204);

    const search = await listShareLinkPage(session, { q: "OLDEST" });
    expect(search.shares.map((share) => share.path)).toEqual(["contracts/oldest-still-active.pdf"]);
    expect((await listShareLinkPage(session, { q: prefix })).total).toBe(205); // creator username
  });

  it("does not show another customer's shares", async () => {
    const other = await listShareLinkPage({ userId: "someone", roles: ["operator"], currentTeamId: `${prefix}-other` });
    expect(other.total).toBe(0);
  });
});
