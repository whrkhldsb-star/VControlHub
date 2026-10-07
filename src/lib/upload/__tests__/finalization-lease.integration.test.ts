// @vitest-environment node
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { beginUploadFinalization, recoverInterruptedFinalizations, type FinalizationLease } from "../finalization-lease";
import { appendMediaUploadChunk, cleanupMediaUploadTempDir, completeMediaUploadSession, initMediaUploadSession, readSessionTempDir } from "../service";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("upload recovery fencing with PostgreSQL", () => {
  const userId = `upload-lease-${randomUUID()}`;
  const ids: string[] = [];
  const leases: FinalizationLease[] = [];
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/test|audit|_ci/.test(url.pathname)) throw new Error("Isolated test database required");
    await prisma.user.create({ data: { id: userId, username: userId, passwordHash: "not-a-login-hash" } });
  });
  afterEach(async () => {
    leases.splice(0).forEach((lease) => lease.stop());
    await prisma.mediaUploadSession.deleteMany({ where: { userId } });
    await Promise.all(ids.splice(0).map(cleanupMediaUploadTempDir));
  });
  afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });
  async function session() {
    const row = await initMediaUploadSession({ userId, filename: "recovery.bin", mimeType: "application/octet-stream", totalSize: 3, chunkSize: 3 });
    ids.push(row.id);
    await appendMediaUploadChunk({ sessionId: row.id, userId, index: 0, size: 3, buffer: Buffer.from("abc") });
    return row.id;
  }
  async function claim(id: string) { const lease = await beginUploadFinalization(id, userId); leases.push(lease); return lease; }
  async function expire(id: string) { await prisma.mediaUploadSession.update({ where: { id }, data: { finalizationLeaseUntil: new Date(0) } }); }

  it("allows one writer, and keeps a slow active write despite original upload TTL", async () => {
    const id = await session();
    const lease = await claim(id);
    await expect(claim(id)).rejects.toThrow();
    await prisma.mediaUploadSession.update({ where: { id }, data: { expiresAt: new Date(0) } });
    await lease.assertActive();
    await recoverInterruptedFinalizations();
    expect((await prisma.mediaUploadSession.findUniqueOrThrow({ where: { id } })).status).toBe("FINALIZING");
  });
  it.each([false, true])("recovers a crashed finalizer and fences late commits (write started=%s)", async (written) => {
    const id = await session();
    const lease = await claim(id);
    if (written) await lease.beforeWrite({ target: "remote/file.bin", checksum: "a".repeat(64) });
    lease.stop(); // Equivalent to losing the execution process: no more heartbeats.
    await expire(id);
    await recoverInterruptedFinalizations();
    const row = await prisma.mediaUploadSession.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "FAILED", recoveryRequired: true });
    expect(await readSessionTempDir(id)).toContain("chunk-0");
    await expect(claim(id)).rejects.toThrow();
    await expect(completeMediaUploadSession({ sessionId: id, userId, checksum: "a".repeat(64), allowedStatuses: ["FINALIZING"], finalizationToken: lease.token })).rejects.toThrow();
    await expect(lease.beforeWrite({ target: "remote/file.bin" })).rejects.toThrow();
  });
  it("recovers after a real process kill without deleting bytes written before index commit", async () => {
    const id = await session();
    const directory = await mkdtemp(join(tmpdir(), "vch-lease-kill-"));
    const target = join(directory, "target.bin");
    const child = fork(resolve("src/lib/upload/__tests__/fixtures/finalizer-child.ts"), [], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, UPLOAD_TEST_ID: id, UPLOAD_TEST_USER: userId, UPLOAD_TEST_TARGET: target },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`Finalizer exited before ready: ${code}`)));
        child.once("message", (message) => {
          const event = message as { token?: string; error?: string };
          if (event.token) resolve(); else reject(new Error(event.error));
        });
      });
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await exited;
      await expire(id);
      await recoverInterruptedFinalizations();
      expect((await prisma.mediaUploadSession.findUniqueOrThrow({ where: { id } })).recoveryRequired).toBe(true);
      expect(await readFile(target, "utf8")).toBe("confirmed fixture bytes");
      expect(await readSessionTempDir(id)).toContain("chunk-0");
      await expect(claim(id)).rejects.toThrow();
    } finally { child.kill("SIGKILL"); await rm(directory, { recursive: true, force: true }); }
  });

  it("cannot revive an expired lease even before maintenance runs", async () => {
    const id = await session(); const lease = await claim(id);
    await expire(id);
    await expect(lease.assertActive()).rejects.toThrow();
    expect((await prisma.mediaUploadSession.findUniqueOrThrow({ where: { id } })).finalizationLeaseUntil?.getTime()).toBe(0);
  });
  it("retains original failure semantics before any write, and requires review after a write attempt", async () => {
    const before = await session(); const pre = await claim(before);
    expect(await pre.fail()).toEqual({ review: false, changed: true });
    const after = await session(); const post = await claim(after);
    await post.beforeWrite({ target: "remote/file.bin" });
    expect(await post.fail()).toEqual({ review: true, changed: true });
  });
  it("leaves legacy unleased finalizers and completed uploads untouched", async () => {
    const legacy = await session();
    await prisma.mediaUploadSession.update({ where: { id: legacy }, data: { status: "FINALIZING", expiresAt: new Date(0) } });
    const completed = await session(); const lease = await claim(completed);
    await completeMediaUploadSession({ sessionId: completed, userId, checksum: "b".repeat(64), allowedStatuses: ["FINALIZING"], finalizationToken: lease.token });
    lease.stop(); await expire(completed);
    await recoverInterruptedFinalizations();
    expect((await prisma.mediaUploadSession.findUniqueOrThrow({ where: { id: legacy } })).status).toBe("FINALIZING");
    expect((await prisma.mediaUploadSession.findUniqueOrThrow({ where: { id: completed } })).status).toBe("COMPLETED");
  });
});
