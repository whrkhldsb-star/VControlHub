import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { config } from "@/lib/config/env";
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

  it("is not signed with the gateway secret itself, which every managed server's gateway holds", () => {
    // Anyone with root on a server that runs the direct-download gateway reads that secret.
    const secret = config.auth.storageGatewaySecret ?? config.auth.sessionSecret ?? "dev-only-share-download-ticket-secret";
    const encoded = Buffer.from(JSON.stringify({ shareId: "share_1", tokenHash: "hash_a", exp: Date.now() + 60_000 })).toString("base64url");
    const forged = `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;

    expect(verifyShareDownloadTicket(forged, "hash_a")).toBeNull();
    expect(verifyShareDownloadTicket(createShareDownloadTicket({ shareId: "share_1", tokenHash: "hash_a" }), "hash_a")).toBe("share_1");
  });
});
