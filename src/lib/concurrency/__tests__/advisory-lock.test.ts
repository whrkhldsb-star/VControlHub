import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn(), end: vi.fn() }));
vi.mock("pg", () => ({
  Pool: vi.fn(function MockPool() { return { connect: mocks.connect, end: mocks.end }; }),
}));
vi.mock("@/lib/config/env", () => ({ config: { db: { url: "postgresql://user:pass@127.0.0.1:5432/db?pool_max=10&connection_limit=10", poolSize: 10, poolIdleTimeoutMs: 30000 } } }));

import { acquireAdvisoryLock, closeAdvisoryLockPoolForTests, getLockKeys, hashToInt32, tryAcquireAdvisoryLock } from "../advisory-lock";

describe("advisory-lock service", () => {
  beforeEach(async () => {
    await closeAdvisoryLockPoolForTests();
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
    mocks.end.mockResolvedValue(undefined);
  });

  it("returns stable namespace and resource keys", () => {
    expect(getLockKeys("backup-restore", "abc").k1).toBe(45057);
    expect(getLockKeys("backup-restore", "resource-123")).toEqual(getLockKeys("backup-restore", "resource-123"));
    expect(getLockKeys("backup-restore", "a").k2).not.toBe(getLockKeys("backup-restore", "b").k2);
    expect(getLockKeys("unknown", "x").k1).toBe(hashToInt32("unknown"));
  });

  it("acquires and releases on the exact same dedicated client", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ unlocked: true }] });
    const release = await acquireAdvisoryLock("backup-restore", "backup-1");
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenNthCalledWith(1, "SELECT pg_advisory_lock($1, $2)", [45057, hashToInt32("backup-1")]);
    expect(mocks.release).not.toHaveBeenCalled();
    await release();
    expect(mocks.query).toHaveBeenNthCalledWith(2, "SELECT pg_advisory_unlock($1, $2) AS unlocked", [45057, hashToInt32("backup-1")]);
    expect(mocks.release).toHaveBeenCalledTimes(1);
    await release();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("releases the client immediately when a non-blocking lock is busy", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    await expect(tryAcquireAdvisoryLock("vps-backup-schedule", "global")).resolves.toBeNull();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful try-lock client until explicit release", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockResolvedValueOnce({ rows: [{ unlocked: true }] });
    const release = await tryAcquireAdvisoryLock("vps-backup-schedule", "global");
    expect(release).not.toBeNull();
    expect(mocks.release).not.toHaveBeenCalled();
    await release!();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("returns the client when lock acquisition throws", async () => {
    mocks.query.mockRejectedValueOnce(new Error("database down"));
    await expect(acquireAdvisoryLock("backup-restore", "backup-1")).rejects.toThrow("database down");
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});
