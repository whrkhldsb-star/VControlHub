// @vitest-environment node
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { initMediaUploadSession, appendMediaUploadChunk, cleanupMediaUploadTempDir } from "@/lib/upload/service";
import { completeStorageFileUpload } from "../resumable-upload";

vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: async () => ({ allowed: true }), releaseStorageQuotaGuard: async () => undefined,
}));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("storage finalization PostgreSQL and filesystem", () => {
  const id = `storage-finalize-${randomUUID()}`;
  const sessions: string[] = [];
  let directory = "";
  let ready = false;
  const actor: SessionPayload = { userId: id, username: id, roles: ["admin"], permissions: ["storage:write"], currentTeamId: null, mustChangePassword: false };
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) throw new Error("Storage integration requires an isolated loopback audit/test database");
    directory = await mkdtemp(path.join(tmpdir(), "vch-storage-finalize-"));
    await prisma.user.create({ data: { id, username: id, passwordHash: "not-a-login-hash" } });
    await prisma.storageNode.create({ data: { id, name: id, driver: "LOCAL", basePath: directory } });
    ready = true;
  });
  afterAll(async () => {
    for (const session of sessions) await cleanupMediaUploadTempDir(session);
    if (ready) {
      await prisma.storageNode.delete({ where: { id } });
      await prisma.user.delete({ where: { id } });
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    await prisma.$disconnect();
  });
  async function upload(relativePath: string) {
    const content = Buffer.alloc(262_147, 0x42);
    const view = await initMediaUploadSession({ userId: id, filename: "fixture.bin", mimeType: "application/octet-stream", totalSize: content.length, chunkSize: 131_072, storageNodeId: id, relativePath, session: actor });
    sessions.push(view.id);
    for (let index = 0; index < view.totalChunks; index++) {
      const buffer = content.subarray(index * view.chunkSize, (index + 1) * view.chunkSize);
      await appendMediaUploadChunk({ sessionId: view.id, userId: id, index, size: buffer.length, buffer });
    }
    return { view, content };
  }
  it("commits a streamed file, checksum and completion in one metadata transaction", async () => {
    const { view, content } = await upload("docs/streamed.bin");
    const result = await completeStorageFileUpload({ sessionId: view.id, session: actor });
    expect(await readFile(path.join(directory, "docs/streamed.bin"))).toEqual(content);
    expect(result.session.status).toBe("COMPLETED");
    const checksum = createHash("sha256").update(content).digest("hex");
    expect(result.session.checksum).toBe(checksum);
    expect(await prisma.fileEntry.findFirst({ where: { storageNodeId: id, relativePath: "docs/streamed.bin" }, select: { size: true, checksumSha256: true } })).toEqual({ size: BigInt(content.length), checksumSha256: checksum });
  });
  it("allows only one finalizer when the same session is completed four times concurrently", async () => {
    const { view, content } = await upload("docs/concurrent.bin");
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => completeStorageFileUpload({ sessionId: view.id, session: actor })));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(3);
    expect(await readFile(path.join(directory, "docs/concurrent.bin"))).toEqual(content);
    expect(await prisma.mediaUploadSession.findUnique({ where: { id: view.id }, select: { status: true } })).toEqual({ status: "COMPLETED" });
  });
});
