// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const auth = vi.hoisted(() => ({ require: vi.fn() }));
vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: auth.require }));
vi.mock("@/lib/image/service", () => ({ deleteImageVariants: vi.fn() }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn() }));

import { deleteImageVariants } from "@/lib/image/service";
import { POST } from "../route";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("all-customer batch deletion", () => {
  const id = "batch-image-" + randomUUID();
  const teams = [id + "-active", id + "-archived"];
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("requires a loopback test database");
    await prisma.user.create({ data: { id, username: id, passwordHash: "fixture" } });
    await prisma.team.createMany({ data: teams.map((team, i) => ({ id: team, name: team, slug: team, deletedAt: i ? new Date() : null })) });
    await prisma.imageUpload.createMany({ data: teams.map(team => ({ id: team, filename: "test.png", storageKey: team + ".png", mimeType: "image/png", sizeBytes: 1, userId: id, teamId: team })) });
    auth.require.mockResolvedValue({ session: { userId: id, username: id, roles: ["admin"], mustChangePassword: false, currentTeamId: null } });
  });
  afterAll(async () => {
    await prisma.imageUpload.deleteMany({ where: { userId: id } });
    await prisma.team.deleteMany({ where: { id: { in: teams } } });
    await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });
  it("unlinks and removes only images with an active owner", async () => {
    const response = await POST(new Request("https://local/api/images/batch", { method: "POST", body: JSON.stringify({ action: "delete", ids: teams }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: 1, filesDeleted: 1 });
    expect(vi.mocked(deleteImageVariants).mock.calls.map(([key]) => key)).toEqual([teams[0] + ".png"]);
    expect(await prisma.imageUpload.findMany({ where: { userId: id }, select: { id: true } })).toEqual([{ id: teams[1] }]);
  });
});
