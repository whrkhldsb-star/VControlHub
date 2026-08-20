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
});
