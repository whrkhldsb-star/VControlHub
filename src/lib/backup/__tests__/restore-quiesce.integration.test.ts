// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { closeAdvisoryLockPoolForTests, tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { claimNextJob } from "@/lib/job/service";

import { isPlatformRestoreInProgress, PLATFORM_RESTORE_LOCK } from "../restore-gate";

/**
 * While a platform restore holds its lock, no worker may start new work: the
 * lock is visible to every process through pg_locks, and claimNextJob must
 * return nothing until it is released. Real PostgreSQL only.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("platform restore quiesces job claiming", () => {
  const type = `restore-quiesce-${randomUUID()}`;

  afterEach(async () => {
    await prisma.job.deleteMany({ where: { type } });
  });
  afterAll(async () => {
    await closeAdvisoryLockPoolForTests();
    await prisma.$disconnect();
  });

  it("claims nothing while the restore lock is held and resumes after release", async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    const pending = await prisma.job.create({ data: { type, title: "queued before restore", payload: {} } });
    expect(await isPlatformRestoreInProgress()).toBe(false);

    const release = await tryAcquireAdvisoryLock(PLATFORM_RESTORE_LOCK.namespace, PLATFORM_RESTORE_LOCK.resourceId);
    expect(release).not.toBeNull();
    try {
      expect(await isPlatformRestoreInProgress()).toBe(true);
      expect(await claimNextJob({ workerId: "quiesce-worker", types: [type] })).toBeNull();
      expect((await prisma.job.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING");
    } finally {
      await release!();
    }

    expect(await isPlatformRestoreInProgress()).toBe(false);
    expect((await claimNextJob({ workerId: "quiesce-worker", types: [type] }))?.id).toBe(pending.id);
  });
});
