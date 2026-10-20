import { Client } from "pg";
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

    it("survives PostgreSQL ending its sessions, idle or holding a lock (restart, 57P01)", async () => {
      // A PostgreSQL restart terminates every session. An 'error' event on
      // a pooled connection with no listener is thrown: that crashed the
      // worker process twice in production.
      const admin = new Client({ connectionString: process.env.DATABASE_URL });
      await admin.connect();
      const holderPid = async (resource: string) => {
        const { k1, k2 } = getLockKeys("backup-restore", resource);
        const { rows } = await admin.query<{ pid: number }>(
          "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = $1::bigint::oid AND objid = $2::bigint::oid AND objsubid = 2",
          [k1 >>> 0, k2 >>> 0],
        );
        return rows[0]!.pid;
      };
      const terminate = async (pids: number[]) => {
        await admin.query("SELECT pg_terminate_backend(pid) FROM unnest($1::int[]) AS pid", [pids]);
        for (let i = 0; i < 50; i++) {
          const { rows } = await admin.query("SELECT 1 FROM pg_stat_activity WHERE pid = ANY($1::int[])", [pids]);
          if (rows.length === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      };
      const uncaught: unknown[] = [];
      const onUncaught = (error: unknown) => { uncaught.push(error); };
      process.on("uncaughtException", onUncaught);
      try {
        const resource = `terminate-${Date.now()}-${Math.random()}`;
        // Two connections: one goes back to the pool idle, one holds a lock.
        const first = await acquireAdvisoryLock("backup-restore", `${resource}-idle`);
        const held = await acquireAdvisoryLock("backup-restore", resource);
        const idlePid = await holderPid(`${resource}-idle`);
        const heldPid = await holderPid(resource);
        expect(heldPid).not.toBe(idlePid);
        await first();
        await terminate([idlePid, heldPid]);
        await held();
        // The lock ended with its session, and the pool takes new ones.
        const again = await tryAcquireAdvisoryLock("backup-restore", resource);
        expect(again).not.toBeNull();
        await again!();
      } finally {
        process.off("uncaughtException", onUncaught);
        await admin.end();
      }
      expect(uncaught).toEqual([]);
    });
  });
}
