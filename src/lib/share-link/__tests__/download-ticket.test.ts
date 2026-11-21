import { describe, expect, it, vi } from "vitest";

import {
  createShareDownloadTicket,
  verifyShareDownloadTicket,
} from "@/lib/share-link/download-ticket";

describe("share download ticket", () => {
  it("is bound to the share token hash", () => {
    const ticket = createShareDownloadTicket({ shareId: "share_1", tokenHash: "hash_a" });

    expect(verifyShareDownloadTicket(ticket, "hash_a")).toBe("share_1");
    expect(verifyShareDownloadTicket(ticket, "hash_b")).toBeNull();
  });

  it("expires quickly", () => {
    vi.useFakeTimers();
    const ticket = createShareDownloadTicket({ shareId: "share_1", tokenHash: "hash_a" });
    vi.advanceTimersByTime(2 * 60 * 1000 + 1);

    expect(verifyShareDownloadTicket(ticket, "hash_a")).toBeNull();
    vi.useRealTimers();
  });

  it("depends only on the control-plane signing key across gateway rotations", () => {
    try {
      vi.stubEnv("AUTH_SESSION_SECRET", "test-session-A");
      vi.stubEnv("STORAGE_DIRECT_ACCESS_SECRET", "test-gateway-A");
      const ticket = createShareDownloadTicket({ shareId: "share_1", tokenHash: "hash_a" });
      vi.stubEnv("STORAGE_DIRECT_ACCESS_SECRET", "test-gateway-B");
      expect(verifyShareDownloadTicket(ticket, "hash_a")).toBe("share_1");
      vi.stubEnv("AUTH_SESSION_SECRET", "test-session-B");
      expect(verifyShareDownloadTicket(ticket, "hash_a")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
