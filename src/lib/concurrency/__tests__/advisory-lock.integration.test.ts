import { afterAll, describe, expect, it } from "vitest";

import { acquireAdvisoryLock, closeAdvisoryLockPoolForTests, getLockKeys, tryAcquireAdvisoryLock } from "../advisory-lock";

const hasDatabase =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "1" &&
  Boolean(process.env.DATABASE_URL);

describe("advisory-lock keys", () => {
  it("maps the same namespace and resource to stable lock keys", () => {
    expect(getLockKeys("backup-restore", "resource-1")).toEqual(
      getLockKeys("backup-restore", "resource-1"),
    );
    expect(getLockKeys("backup-restore", "resource-1")).not.toEqual(
      getLockKeys("backup-restore", "resource-2"),
    );
  });
});

if (hasDatabase) {
  describe("advisory-lock PostgreSQL integration", () => {
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
}
