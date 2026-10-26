// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimitAsync: mocks.check, getClientIp: () => "198.51.100.7" }));
vi.mock("@/lib/i18n/translations", () => ({ getServerLocale: async () => "en", t: (key: string) => key }));
vi.mock("@/lib/ai/chat-orchestrator", () => ({ createAiChatResponse: vi.fn() }));

import { POST } from "../route";

describe("AI chat rate limit", () => {
  it("counts chat messages in their own bucket, not the bare client IP the 2FA check also used", async () => {
    mocks.check.mockResolvedValue({ allowed: false, retryAfterMs: 1_000, remaining: 0 });
    const response = await POST(new Request("https://hub.test/api/ai/chat", { method: "POST", body: "{}" }));
    expect(response.status).toBe(429);
    expect(mocks.check).toHaveBeenCalledWith("ai-chat:198.51.100.7", expect.objectContaining({ maxRequests: 20 }));
  });
});
