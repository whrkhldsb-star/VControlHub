import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deleteMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { revokedSession: { deleteMany: mocks.deleteMany } } }));

const { pruneExpiredRevokedSessions, REVOCATION_PRUNE_GRACE_MS } = await import("../session-revocation");

describe("pruneExpiredRevokedSessions", () => {
  beforeEach(() => {
    mocks.deleteMany.mockReset();
    mocks.deleteMany.mockResolvedValue({ count: 3 });
  });

  it("deletes only revocations whose cookie expired more than the grace period ago", async () => {
    const now = new Date("2026-11-27T12:00:00.000Z");
    await expect(pruneExpiredRevokedSessions(now)).resolves.toEqual({ count: 3 });
    expect(REVOCATION_PRUNE_GRACE_MS).toBe(60 * 60_000);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date("2026-11-27T11:00:00.000Z") } },
    });
  });

  it("defaults to the current time", async () => {
    const before = Date.now();
    await pruneExpiredRevokedSessions();
    const cutoff = (mocks.deleteMany.mock.calls[0]?.[0] as { where: { expiresAt: { lt: Date } } }).where.expiresAt.lt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - REVOCATION_PRUNE_GRACE_MS);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - REVOCATION_PRUNE_GRACE_MS);
  });
});
