/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The only endpoint in the app reachable without a session, so its guards are
 * the ones that matter most: shared-store rate limiting (per connection AND per
 * IP), a body cap applied before parse, and signature verification before any
 * side effect.
 */

const mocks = vi.hoisted(() => ({
  checkRateLimitAsync: vi.fn(),
  handleInboundWebhook: vi.fn(),
  roleFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  getClientIp: (request: Request) =>
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    role: { findFirst: mocks.roleFindFirst },
    user: { findFirst: mocks.userFindFirst },
  },
}));
vi.mock("@/lib/itsm/service", () => ({
  handleInboundWebhook: mocks.handleInboundWebhook,
}));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { POST } = await import("../route");

const CONTEXT = { params: Promise.resolve({ connectionId: "conn_1" }) };

function inbound(body: string, headers: Record<string, string> = {}) {
  return new Request("https://hub.example/api/itsm/inbound/conn_1", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

function allowed() {
  return { allowed: true, retryAfterMs: 0, remaining: 29 };
}

describe("POST /api/itsm/inbound/[connectionId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitAsync.mockResolvedValue(allowed());
    mocks.roleFindFirst.mockResolvedValue({ id: "role_admin" });
    mocks.userFindFirst.mockResolvedValue({ id: "u_admin" });
    mocks.handleInboundWebhook.mockResolvedValue({
      event: { id: "evt_1", status: "ok" },
      ticketId: "tkt_1",
      action: "create",
    });
  });

  it("limits per connection and per source IP through the shared store", async () => {
    await POST(inbound(JSON.stringify({ title: "disk full" }), { "x-forwarded-for": "203.0.113.9" }), CONTEXT);

    const keys = mocks.checkRateLimitAsync.mock.calls.map((call) => call[0] as string);
    // Per-connection alone would let anyone who learns a connection id exhaust
    // that connection's budget and lock out its real sender.
    expect(keys).toContain("itsm-inbound:conn:conn_1");
    expect(keys).toContain("itsm-inbound:ip:203.0.113.9");
  });

  it("returns 429 with Retry-After when either limit is exhausted", async () => {
    mocks.checkRateLimitAsync
      .mockResolvedValueOnce(allowed())
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 4_200, remaining: 0 });

    const response = await POST(inbound(JSON.stringify({ title: "x" })), CONTEXT);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(mocks.handleInboundWebhook).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body before reading it", async () => {
    const response = await POST(
      inbound(JSON.stringify({ title: "x" }), { "content-length": String(2 * 1024 * 1024) }),
      CONTEXT,
    );

    expect(response.status).toBe(413);
    expect(mocks.handleInboundWebhook).not.toHaveBeenCalled();
  });

  it("rejects an oversized actual body even when content-length lies", async () => {
    // A chunked or misdeclared request must still be capped after the read.
    const response = await POST(
      inbound(JSON.stringify({ pad: "x".repeat(1024 * 1024 + 64) })),
      CONTEXT,
    );

    expect(response.status).toBe(413);
    expect(mocks.handleInboundWebhook).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without invoking the handler", async () => {
    const response = await POST(inbound("{not json"), CONTEXT);

    expect(response.status).toBe(400);
    expect(mocks.handleInboundWebhook).not.toHaveBeenCalled();
  });

  it("forwards the raw body and signature header so HMAC covers the exact bytes", async () => {
    const raw = JSON.stringify({ title: "disk full", external_id: "EXT-1" });
    await POST(inbound(raw, { "x-hub-signature-256": "sha256=abc" }), CONTEXT);

    expect(mocks.handleInboundWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "conn_1",
        // Re-serializing the parsed JSON would change the bytes and break HMAC.
        rawBody: raw,
        signatureHeader: "sha256=abc",
        systemUserId: "u_admin",
      }),
    );
  });

  it("maps a rejected signature to its typed status instead of 200", async () => {
    const { ForbiddenError } = await import("@/lib/errors");
    mocks.handleInboundWebhook.mockRejectedValue(new ForbiddenError("Invalid webhook signature"));

    const response = await POST(inbound(JSON.stringify({ title: "x" })), CONTEXT);

    expect(response.status).toBe(403);
  });

  it("returns 503 rather than attributing tickets to nobody when no user exists", async () => {
    mocks.roleFindFirst.mockResolvedValue(null);
    mocks.userFindFirst.mockResolvedValue(null);

    const response = await POST(inbound(JSON.stringify({ title: "x" })), CONTEXT);

    expect(response.status).toBe(503);
    expect(mocks.handleInboundWebhook).not.toHaveBeenCalled();
  });
});
