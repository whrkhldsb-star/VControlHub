// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { exportFileSchema } from "@/lib/system/config-schema";
import { updateAnnouncement } from "./service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("announcement validity", () => {
  const id = randomUUID();
  const day = (n: number) => new Date(Date.UTC(2027, 0, n));
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("requires an isolated test database");
    await prisma.announcement.create({ data: { id, title: "Window", body: "Notice", startsAt: day(1), expiresAt: day(10) } });
  });
  afterAll(async () => { await prisma.announcement.deleteMany({ where: { id } }); await prisma.$disconnect(); });
  it("serializes competing edits and rejects zero or inverted import windows", async () => {
    const results = await Promise.allSettled([updateAnnouncement(id, { startsAt: day(8) }), updateAnnouncement(id, { expiresAt: day(5) })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const row = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    expect(row.expiresAt!.getTime()).toBeGreaterThan(row.startsAt.getTime());
    const imported = JSON.parse(JSON.stringify(row));
    for (const end of [5, 8]) expect(exportFileSchema.shape.tables.shape.announcements.safeParse([
      { ...imported, startsAt: day(8).toISOString(), expiresAt: day(end).toISOString() },
    ]).success).toBe(false);
  });
});
