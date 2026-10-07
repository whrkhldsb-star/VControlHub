import { afterEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ updateMany: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { mediaUploadSession: { updateMany: db.updateMany }, $executeRaw: db.execute } }));
import { beginUploadFinalization, FINALIZATION_HEARTBEAT_MS, FINALIZATION_LEASE_MS } from "../finalization-lease";

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe("finalization heartbeat", () => {
  it("renews slow active finalizers beyond the original lease", async () => {
    vi.useFakeTimers(); db.updateMany.mockResolvedValue({ count: 1 }); db.execute.mockResolvedValue(1);
    const lease = await beginUploadFinalization("id", "user");
    try {
      await vi.advanceTimersByTimeAsync(FINALIZATION_LEASE_MS * 3);
      await expect(lease.assertActive()).resolves.toBeUndefined();
      expect(db.execute.mock.calls.length).toBeGreaterThan(10);
    } finally { lease.stop(); }
  });
  it("does not let a delayed heartbeat resurrect expired local ownership", async () => {
    vi.useFakeTimers(); db.updateMany.mockResolvedValue({ count: 1 });
    let resolve!: (count: number) => void;
    db.execute.mockImplementation(() => new Promise<number>((done) => { resolve = done; }));
    const lease = await beginUploadFinalization("id", "user");
    try {
      await vi.advanceTimersByTimeAsync(FINALIZATION_HEARTBEAT_MS + FINALIZATION_LEASE_MS);
      resolve(1);
      await Promise.resolve();
      await expect(lease.beforeWrite({ target: "file" })).rejects.toMatchObject({ code: "UPLOAD_OUTCOME_UNKNOWN" });
      expect(db.updateMany).toHaveBeenCalledTimes(1);
    } finally { lease.stop(); }
  });
});
