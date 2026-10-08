// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { appendMediaUploadChunk, assembleMediaUploadChunks, cleanupMediaUploadTempDir, initMediaUploadSession, readSessionTempDir, UPLOAD_TMP_DIR } from "../service";
import { POST } from "@/app/api/images/upload/[id]/complete/route";

const fixture = vi.hoisted(() => ({
  userId: "", failAfterCompletion: false,
  directory: `/tmp/vch-finalization-integration-${process.pid}`,
}));
vi.mock("@/lib/image-bed/constants", () => ({ UPLOAD_DIR: fixture.directory }));
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: async (_request: Request, _options: unknown, callback: (context: unknown) => Promise<Response>) => {
    try {
      return await callback({ session: { userId: fixture.userId, roles: ["admin"], currentTeamId: null } });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 400 });
    }
  },
}));
vi.mock("@/lib/i18n/translations", () => ({ getServerLocale: async () => "en", t: (key: string) => key }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn() }));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: async () => ({ allowed: true }), releaseStorageQuotaGuard: async () => undefined,
}));
vi.mock("@/lib/upload/service", async (original) => {
  const actual = await original<typeof import("../service")>();
  return { ...actual, completeMediaUploadSession: async (params: Parameters<typeof actual.completeMediaUploadSession>[0]) => {
    const result = await actual.completeMediaUploadSession(params);
    if (fixture.failAfterCompletion) throw new Error("injected failure after completion update");
    return result;
  } };
});

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("image finalization PostgreSQL transactions", () => {
  const id = `upload-audit-${randomUUID()}`;
  const sessions: string[] = [];
  let ready = false;
  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("Upload integration requires an isolated loopback audit/test database");
    }
    fixture.userId = id;
    await prisma.user.create({ data: { id, username: id, passwordHash: "fixture-not-a-login-hash" } });
    await prisma.storageNode.create({ data: { id, name: id, driver: "LOCAL", basePath: `${fixture.directory}/linked` } });
    ready = true;
  });
  afterEach(async () => {
    fixture.failAfterCompletion = false;
    if (!ready) return;
    await prisma.imageUpload.deleteMany({ where: { userId: id } });
    await prisma.fileEntry.deleteMany({ where: { storageNodeId: id } });
    await prisma.mediaUploadSession.deleteMany({ where: { userId: id } });
    await Promise.all(sessions.splice(0).map(cleanupMediaUploadTempDir));
    await rm(fixture.directory, { recursive: true, force: true });
  });
  afterAll(async () => {
    if (ready) {
      await prisma.storageNode.delete({ where: { id } });
      await prisma.user.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });
  const upload = async () => {
    await mkdir(fixture.directory, { recursive: true });
    const buffer = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#24a887" } }).png().toBuffer();
    const session = await initMediaUploadSession({ userId: id, filename: "fixture.png", mimeType: "image/png", totalSize: buffer.length, chunkSize: buffer.length });
    sessions.push(session.id);
    await prisma.mediaUploadSession.update({ where: { id: session.id }, data: { storageNodeId: id, relativePath: "gallery" } });
    await appendMediaUploadChunk({ sessionId: session.id, userId: id, index: 0, size: buffer.length, buffer });
    return session.id;
  };
  const complete = (sessionId: string) => POST(new Request(`http://local/api/images/upload/${sessionId}/complete`, { method: "POST" }), { params: Promise.resolve({ id: sessionId }) });

  it("keeps chunks immutable when a database finalizer wins against an in-flight duplicate", async () => {
    const sessionId = await upload();
    const chunkPath = `${UPLOAD_TMP_DIR}/${sessionId}/chunk-0`;
    const original = await readFile(chunkPath);
    let locked!: () => void;
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const finalizer = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM media_upload_sessions WHERE id = ${sessionId} FOR UPDATE`;
      await tx.mediaUploadSession.update({ where: { id: sessionId }, data: { status: "FINALIZING" } });
      locked();
      await released;
    }, { timeout: 10_000 });
    await acquired;
    let settled = false;
    const retry = appendMediaUploadChunk({ sessionId, userId: id, index: 0, size: original.length, buffer: Buffer.alloc(original.length, 2) })
      .then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }))
      .finally(() => { settled = true; });
    try {
      await vi.waitFor(async () => {
        expect((await readSessionTempDir(sessionId)).some((name) => name.endsWith(".tmp"))).toBe(true);
      }, { timeout: 3_000 });
      expect(settled).toBe(false);
      expect(await readFile(chunkPath)).toEqual(original);
    } finally {
      release();
      await finalizer;
    }
    expect((await retry).error).toMatchObject({ code: "session_not_active" });
    expect(await readFile(chunkPath)).toEqual(original);
    expect(await readSessionTempDir(sessionId)).toEqual(["chunk-0"]);
  });

  it("retains every index under sixteen parallel chunk writes", async () => {
    const session = await initMediaUploadSession({ userId: id, filename: "parallel.bin", mimeType: "application/octet-stream", totalSize: 64, chunkSize: 4 });
    sessions.push(session.id);
    const buffers = Array.from({ length: 16 }, (_, index) => Buffer.alloc(4, index));
    await Promise.all(buffers.map((buffer, index) => appendMediaUploadChunk({ sessionId: session.id, userId: id, index, size: buffer.length, buffer })));
    expect(await assembleMediaUploadChunks(session.id, id)).toEqual(Buffer.concat(buffers));
  });

  it("commits one image and one linked index under eight competing finalizers", async () => {
    const sessionId = await upload();
    const responses = await Promise.all(Array.from({ length: 8 }, () => complete(sessionId)));
    expect(responses.filter((response) => response.ok)).toHaveLength(1);
    expect(await prisma.imageUpload.count({ where: { userId: id } })).toBe(1);
    expect(await prisma.fileEntry.count({ where: { storageNodeId: id } })).toBe(1);
    const session = await prisma.mediaUploadSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("COMPLETED");
    expect(session.resultImageId).toBeTruthy();
    expect(await readSessionTempDir(sessionId)).toEqual([]);
  });

  it("rolls back database records but retains recovery artifacts after an uncertain commit", async () => {
    const sessionId = await upload();
    fixture.failAfterCompletion = true;
    expect((await complete(sessionId)).ok).toBe(false);
    expect(await prisma.imageUpload.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.fileEntry.count({ where: { storageNodeId: id } })).toBe(0);
    const session = await prisma.mediaUploadSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session).toMatchObject({ status: "FAILED", resultImageId: null, checksum: null, recoveryRequired: true });
    expect(await readSessionTempDir(sessionId)).toContain("chunk-0");
    expect((await readdir(fixture.directory)).length).toBeGreaterThan(1);
    expect((await readdir(`${fixture.directory}/linked/gallery`)).length).toBeGreaterThan(0);
  });
});
