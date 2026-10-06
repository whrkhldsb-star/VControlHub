// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { changePassword } from "../service";
import { hashPassword } from "../password";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("credential changes under PostgreSQL concurrency", () => {
  const id = `credential-audit-${randomUUID()}`;
  const currentPassword = "Audit-Current-Secret-2026!";
  const nextPassword = "Audit-Next-Secret-2026!";
  let currentHash: string;
  let resetHash: string;
  let ready = false;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("Credential integration requires an isolated loopback audit/test database");
    }
    [currentHash, resetHash] = await Promise.all([hashPassword(currentPassword), hashPassword("Administrator-Reset-2026!")]);
    await prisma.user.create({ data: { id, username: id, passwordHash: currentHash, sessionEpoch: 4, status: "ACTIVE" } });
    ready = true;
  });
  beforeEach(async () => {
    await prisma.user.update({ where: { id }, data: { passwordHash: currentHash, sessionEpoch: 4, status: "ACTIVE" } });
  });
  afterAll(async () => {
    if (ready) {
      await prisma.auditLog.deleteMany({ where: { actorId: id } });
      await prisma.user.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  it.each(["disable", "password reset", "session revocation"])("does not overwrite a concurrent administrator %s", async (change) => {
    let release!: () => void;
    let acquired!: (pid: number) => void;
    const unlocked = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<number>((resolve) => { acquired = resolve; });
    const adminChange = prisma.$transaction(async (tx) => {
      const processes = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await tx.user.update({
        where: { id },
        data: change === "disable" ? { status: "DISABLED" }
          : change === "password reset" ? { passwordHash: resetHash }
            : { sessionEpoch: { increment: 1 } },
      });
      acquired(processes[0]!.pid);
      await unlocked;
    }, { timeout: 15_000 });
    const blocker = await locked;
    const passwordChange = changePassword({ userId: id, currentPassword, newPassword: nextPassword, confirmPassword: nextPassword });
    try {
      await vi.waitFor(async () => {
        const waiters = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity a
            WHERE ${blocker} = ANY(pg_blocking_pids(a.pid))
          ) AS waiting
        `;
        expect(waiters[0]!.waiting).toBe(true);
      }, { timeout: 8_000, interval: 25 });
    } finally {
      release();
      await adminChange;
    }
    expect((await passwordChange).success).toBe(false);
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.status).toBe(change === "disable" ? "DISABLED" : "ACTIVE");
    expect(user.passwordHash).toBe(change === "password reset" ? resetHash : currentHash);
    expect(user.sessionEpoch).toBe(change === "session revocation" ? 5 : 4);
  }, 20_000);
});
