// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

import { createShareLinkFromFileEntry, hashShareToken, listShareLinkPage, resolveShareToken, revokeShareLink } from "../service";

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

  it.each([
    { field: "revokedAt", maxDownloads: null },
    { field: "expiresAt", maxDownloads: null },
    { field: "expiresAt", maxDownloads: 2 },
  ] as const)("rechecks $field after a pending claim acquires the row lock (limit $maxDownloads)", async ({ field, maxDownloads }) => {
    const token = randomUUID();
    const share = await prisma.shareLink.create({ data: {
      storageNodeId: prefix, path: "queued.txt", createdBy: prefix, teamId: prefix, maxDownloads, tokenHash: hashShareToken(token),
    } });
    let claim: Promise<boolean> | undefined;
    try {
      await prisma.$transaction(async tx => {
        const [locker] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid FROM share_links WHERE id = ${share.id} FOR UPDATE`;
        claim = resolveShareToken(token).then(() => true, () => false);
        // The initial read succeeded. Wait until the claim itself queues behind this transaction.
        await vi.waitFor(async () => {
          await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
          const blocked = await tx.$queryRaw<Array<{ waiting: boolean }>>`
            SELECT EXISTS (SELECT FROM pg_stat_activity WHERE ${locker!.pid}::int = ANY(pg_blocking_pids(pid))) AS waiting
          `;
          expect(blocked[0]?.waiting).toBe(true);
        }, { timeout: 6000, interval: 25 });
        await tx.shareLink.update({ where: { id: share.id }, data: { [field]: new Date(0) } });
      }, { timeout: 10000 });
      expect(await claim).toBe(false);
      expect((await prisma.shareLink.findUniqueOrThrow({ where: { id: share.id } })).accessCount).toBe(0);
    } finally {
      await claim;
      await prisma.shareLink.delete({ where: { id: share.id } });
    }
  });

  it.each(["create", "claim"] as const)("binds a queued share %s to the locked path", async operation => {
    const file = await prisma.fileEntry.create({ data: { name: "selected", relativePath: "selected", entryType: "FILE", storageNodeId: prefix } });
    const token = randomUUID();
    const share = await prisma.shareLink.create({ data: { storageNodeId: prefix, path: "selected", tokenHash: hashShareToken(token), createdBy: prefix, teamId: prefix } });
    let queued: Promise<string> | undefined;
    try {
      await prisma.$transaction(async tx => {
        const [locker] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid FROM file_entries WHERE id = ${file.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM share_links WHERE id = ${share.id} FOR UPDATE`;
        queued = operation === "create"
          ? createShareLinkFromFileEntry({ session: { ...session, roles: ["admin"], username: prefix, mustChangePassword: false }, fileEntryId: file.id })
              .then(row => row.share.path, error => error.status === 404 ? "stale" : Promise.reject(error))
          : resolveShareToken(token).then(row => row.path);
        await vi.waitFor(async () => {
          await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
          const [blocked] = await tx.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT FROM pg_stat_activity
            WHERE ${locker!.pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`;
          expect(blocked?.waiting).toBe(true);
        }, { timeout: 6000, interval: 25 });
        await tx.fileEntry.update({ where: { id: file.id }, data: { relativePath: "moved" } });
        await tx.shareLink.update({ where: { id: share.id }, data: { path: "moved" } });
      }, { timeout: 10000 });
      expect(await queued).toBe(operation === "create" ? "stale" : "moved");
      expect(await prisma.shareLink.count({ where: { storageNodeId: prefix, path: "selected" } })).toBe(0);
    } finally {
      await Promise.allSettled([queued]);
      await prisma.shareLink.deleteMany({ where: { storageNodeId: prefix, path: { in: ["selected", "moved"] } } });
      await prisma.fileEntry.delete({ where: { id: file.id } });
    }
  });

  it("admits one of two simultaneous last downloads and returns only revocation metadata", async () => {
    const token = randomUUID();
    const share = await prisma.shareLink.create({ data: {
      storageNodeId: prefix, path: "one.txt", createdBy: prefix, teamId: prefix, maxDownloads: 1, tokenHash: hashShareToken(token),
    } });
    try {
      const downloads = await Promise.allSettled([resolveShareToken(token), resolveShareToken(token)]);
      expect(downloads.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.shareLink.findUnique({ where: { id: share.id }, select: { accessCount: true } })).toEqual({ accessCount: 1 });
      const revoked = await revokeShareLink(share.id, prefix, session);
      expect(revoked).toEqual({ id: share.id, revokedAt: expect.any(Date) });
    } finally {
      await prisma.shareLink.delete({ where: { id: share.id } });
    }
  });

});
