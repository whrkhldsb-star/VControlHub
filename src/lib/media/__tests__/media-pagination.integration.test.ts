// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { countMediaItems, listMediaItems } from "../service";

/**
 * 450 media items of one customer, all sharing one updatedAt (a scan writes
 * them in one batch). Paging must visit every item exactly once, and the
 * totals must count the database, not the loaded page. Real PostgreSQL only.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("media library pagination", () => {
  const prefix = `media-page-${randomUUID()}`;
  const session = { userId: prefix, roles: ["operator" as const], currentTeamId: prefix };

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
    await prisma.storageNode.create({ data: { id: prefix, name: prefix, driver: "LOCAL", basePath: "/nonexistent-media-fixture", teamId: prefix } });
    await prisma.mediaItem.createMany({
      data: Array.from({ length: 450 }, (_, index) => ({
        storageNodeId: prefix,
        name: `clip-${index}.mp4`,
        relativePath: `videos/clip-${index}.mp4`,
        mimeType: "video/mp4",
        mediaType: "video",
        favorite: index % 10 === 0,
      })),
    });
    await prisma.mediaItem.updateMany({ where: { storageNodeId: prefix }, data: { updatedAt: new Date("2026-10-01T00:00:00Z") } });
  });

  afterAll(async () => {
    await prisma.mediaItem.deleteMany({ where: { storageNodeId: prefix } });
    await prisma.storageNode.deleteMany({ where: { id: prefix } });
    await prisma.team.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  it("visits every item exactly once across pages despite identical timestamps", async () => {
    expect(await countMediaItems({ session })).toBe(450);
    const seen: string[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const items = await listMediaItems({ session, page, pageSize: 100 });
      seen.push(...items.map((item) => item.id));
    }
    expect(seen).toHaveLength(450);
    expect(new Set(seen).size).toBe(450);
  });

  it("counts favourites and filtered matches in the database", async () => {
    expect(await countMediaItems({ session, favorite: true })).toBe(45);
    expect(await countMediaItems({ session, q: "clip-44" })).toBe(11); // clip-44, clip-440…449
    expect(await countMediaItems({ session: { ...session, currentTeamId: `${prefix}-other` } })).toBe(0);
  });
});
