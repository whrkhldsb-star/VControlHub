// @vitest-environment node
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { imageTeamWhere, playbookTeamWhere, rawActiveCustomerScope, type TeamSession } from "../team-scope";

afterAll(async () => { await prisma.$disconnect(); });

it.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("excludes archived images and playbooks in both global and customer scopes", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) {
    throw new Error("Disposable database required");
  }
  const userId = randomUUID();
  const live = randomUUID(), archived = randomUUID(), legacy = randomUUID();
  await prisma.$transaction(async tx => {
    await tx.user.create({ data: { id: userId, username: userId, passwordHash: "fixture" } });
    await tx.team.createMany({ data: [live, archived].map(id => ({ id, name: id, slug: id, deletedAt: id === archived ? new Date() : null })) });
    const ids = [live, archived, legacy];
    for (const id of ids) {
      const teamId = id === legacy ? null : id;
      await tx.imageUpload.create({ data: { id, teamId, userId, filename: id, storageKey: id, mimeType: "image/png", sizeBytes: 1 } });
      await tx.playbook.create({ data: { id, teamId, name: id, triggerType: "cron", triggerConfig: {}, steps: [] } });
    }
    const global: TeamSession = { userId, roles: ["admin"], currentTeamId: null };
    for (const [session, visible] of [[global, [live, legacy]], [{ ...global, currentTeamId: archived }, []], [{ ...global, currentTeamId: live }, [live]]] as const) {
      const expected = [...visible].sort();
      const images = await tx.imageUpload.findMany({ where: { id: { in: ids }, ...imageTeamWhere(session) }, select: { id: true } });
      const playbooks = await tx.playbook.findMany({ where: { id: { in: ids }, ...playbookTeamWhere(session) }, select: { id: true } });
      const raw = await tx.$queryRaw<Array<{ id: string }>>`SELECT i.id FROM image_uploads i
        WHERE i."userId" = ${userId} AND ${rawActiveCustomerScope(session, Prisma.sql`i."teamId"`)}`;
      for (const rows of [images, playbooks, raw]) expect(rows.map(row => row.id).sort()).toEqual(expected);
    }
    await tx.playbook.deleteMany({ where: { id: { in: ids } } });
    await tx.user.delete({ where: { id: userId } });
    await tx.team.deleteMany({ where: { id: { in: [live, archived] } } });
  });
});
