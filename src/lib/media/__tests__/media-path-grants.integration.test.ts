// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { countMediaItems, getMediaItem, getMediaNeighbors, listMediaItems, listMediaTags, listMediaTypeCounts, updateMediaTags } from "../service";

/**
 * A customer account narrowed by a path grant could not play or preview a
 * file outside it, yet the media library listed its name, path and tags and
 * counted it. The library now shows what the account may read, as the
 * recycle bin does. Real PostgreSQL only.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("media library path grants", () => {
  const prefix = `media-grant-${randomUUID()}`;
  const ids: Record<string, string> = {};
  const narrowed = { userId: prefix, roles: [], currentTeamId: prefix, permissions: ["storage:read" as const, "media:manage" as const] };

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
    await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "x", currentTeamId: prefix } });
    await prisma.storageNode.create({ data: { id: prefix, name: prefix, driver: "LOCAL", basePath: "/nonexistent-media-fixture", teamId: prefix } });
    await prisma.userStorageAccess.create({ data: { userId: prefix, storageNodeId: prefix, pathPrefix: "projectA", canRead: true } });
    for (const [key, relativePath, mediaType, tag] of [
      ["inside", "projectA/a.png", "image", "alpha"],
      ["nested", "projectA/sub/b.mp4", "video", "alpha"],
      ["outside", "projectB/c.png", "image", "secret"],
      ["sibling", "projectA2/d.png", "image", "secret"],
    ] as const) {
      const row = await prisma.mediaItem.create({
        data: { storageNodeId: prefix, name: relativePath.split("/").at(-1)!, relativePath, mimeType: mediaType === "image" ? "image/png" : "video/mp4", mediaType, tags: [tag] },
      });
      ids[key] = row.id;
    }
  });

  afterAll(async () => {
    await prisma.mediaItem.deleteMany({ where: { storageNodeId: prefix } });
    await prisma.userStorageAccess.deleteMany({ where: { storageNodeId: prefix } });
    await prisma.storageNode.deleteMany({ where: { id: prefix } });
    await prisma.user.deleteMany({ where: { id: prefix } });
    await prisma.team.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  it("lists, counts and tags only the granted paths", async () => {
    const listed = await listMediaItems({ session: narrowed });
    expect(listed.map((item) => item.relativePath).sort()).toEqual(["projectA/a.png", "projectA/sub/b.mp4"]);
    expect(await countMediaItems({ session: narrowed })).toBe(2);
    expect(await countMediaItems({ session: narrowed, q: "png" })).toBe(1);
    expect(await listMediaTypeCounts({ session: narrowed })).toEqual({ image: 1, video: 1, audio: 0 });
    expect((await listMediaTags(narrowed)).map((row) => row.tag)).toEqual(["alpha"]);
  });

  it("does not open, walk to or edit an item outside the grants", async () => {
    expect(await getMediaItem(ids.inside!, narrowed)).not.toBeNull();
    expect(await getMediaItem(ids.outside!, narrowed)).toBeNull();
    expect(await getMediaItem(ids.sibling!, narrowed)).toBeNull();
    const inside = await prisma.mediaItem.findUniqueOrThrow({ where: { id: ids.inside! } });
    const neighbours = await getMediaNeighbors(inside, { session: narrowed });
    expect([neighbours.previous?.id, neighbours.next?.id].filter(Boolean)).toEqual([ids.nested]);
    await expect(updateMediaTags({ id: ids.outside!, tags: ["mine"], session: narrowed })).rejects.toMatchObject({ status: 404 });
  });

  it("still shows a whole node without grants, and everything to an administrator", async () => {
    await prisma.userStorageAccess.deleteMany({ where: { storageNodeId: prefix } });
    try {
      expect(await countMediaItems({ session: narrowed })).toBe(4);
    } finally {
      await prisma.userStorageAccess.create({ data: { userId: prefix, storageNodeId: prefix, pathPrefix: "projectA", canRead: true } });
    }
    expect(await countMediaItems({ session: { userId: prefix, roles: ["admin"], currentTeamId: null } })).toBeGreaterThanOrEqual(4);
  });
});
