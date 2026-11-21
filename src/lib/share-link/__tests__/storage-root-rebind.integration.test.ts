// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as storageAccess from "@/lib/storage/access-control";
import { updateServerProfile } from "@/lib/server/service-profiles";
import { updateStorageNode } from "@/lib/storage/service-nodes";
import { createShareLink, peekShareToken } from "../service";

// The profile and share transactions run against PostgreSQL. The SSH connectivity probe stays local to the fixture.
vi.mock("@/lib/ssh/client", async (original) => ({
  ...await original<typeof import("@/lib/ssh/client")>(),
  execRemoteCommand: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
}));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("public shares during a storage rebind", () => {
  const id = `share-rebind-${randomUUID()}`;
  const session = { userId: id, username: id, roles: ["admin" as const], mustChangePassword: false, currentTeamId: null };
  const sftpId = id + "-sftp";
  let prepared = false;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) {
      throw new Error("Share rebind test requires an isolated loopback test database");
    }
    await prisma.$transaction([
      prisma.user.create({ data: { id, username: id, passwordHash: "unusable" } }),
      prisma.storageNode.create({ data: { id, name: id, driver: "LOCAL", basePath: "/old" } }),
      prisma.server.create({ data: {
        id: sftpId, name: sftpId, host: id + ".test", port: 22, username: "files", connectionType: "PASSWORD",
        password: "fixture", storageNode: { create: { id: sftpId, name: sftpId, driver: "SFTP", basePath: "/files" } },
      } }),
    ]);
    prepared = true;
  });
  afterAll(async () => {
    if (prepared) await prisma.$transaction([
      prisma.storageNode.deleteMany({ where: { id: { in: [id, sftpId] } } }),
      prisma.server.delete({ where: { id: sftpId } }),
      prisma.user.delete({ where: { id } }),
    ]);
    await prisma.$disconnect();
  });

  it.each([
    { change: "LOCAL root", storageNodeId: id, rebind: () => updateStorageNode({ storageNodeId: id, basePath: "/new" }) },
    { change: "inherited SFTP port", storageNodeId: sftpId, rebind: () => updateServerProfile(sftpId, {
      port: 2222, password: "new fixture", approvedHostKeySha256: "SHA256:fixture",
    }) },
  ])("revokes committed and in-flight links on changing $change", async ({ storageNodeId, rebind }) => {
    const input = { session, storageNodeId, path: "docs/file.txt" };
    const old = await createShareLink(input);
    await updateStorageNode({ storageNodeId, name: "New display name" });
    expect((await peekShareToken(old.token)).id).toBe(old.share.id);

    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const gate = vi.spyOn(storageAccess, "assertStorageAccess").mockImplementationOnce(async () => {
      started.resolve();
      await resume.promise;
      return { allowed: true };
    });
    const pending = createShareLink(input);
    try {
      await Promise.race([started.promise, pending]);
      await rebind();
    } finally {
      resume.resolve();
      gate.mockRestore();
    }
    await expect(pending).rejects.toMatchObject({ status: 404 });
    await expect(peekShareToken(old.token)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.shareLink.count({ where: { storageNodeId, revokedAt: null } })).toBe(0);
  });
});
