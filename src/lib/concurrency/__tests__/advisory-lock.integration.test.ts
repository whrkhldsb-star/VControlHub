import { afterAll, describe, expect, it } from "vitest";

import { acquireAdvisoryLock, closeAdvisoryLockPoolForTests, tryAcquireAdvisoryLock } from "../advisory-lock";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("advisory-lock PostgreSQL integration", () => {
  afterAll(async () => { await closeAdvisoryLockPoolForTests(); });

  it("holds the lock on one session until release and exposes it afterwards", async () => {
    const resource = `integration-${Date.now()}-${Math.random()}`;
    const releaseFirst = await acquireAdvisoryLock("backup-restore", resource);
    const whileHeld = await tryAcquireAdvisoryLock("backup-restore", resource);
    expect(whileHeld).toBeNull();
    await releaseFirst();
    const afterRelease = await tryAcquireAdvisoryLock("backup-restore", resource);
    expect(afterRelease).not.toBeNull();
    await afterRelease!();
  });
});
