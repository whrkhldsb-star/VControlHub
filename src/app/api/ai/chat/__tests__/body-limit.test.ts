// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (_request: Request, options: Record<string, unknown>) => {
		guard.options.push(options);
		return Response.json({ ok: true });
	}),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimitAsync: async () => ({ allowed: true, retryAfterMs: 0, remaining: 5 }), getClientIp: () => "198.51.100.7" }));
vi.mock("@/lib/i18n/translations", () => ({ getServerLocale: async () => "en", t: (key: string) => key }));
vi.mock("@/lib/ai/chat-orchestrator", () => ({ createAiChatResponse: vi.fn() }));

import { chatRequestSchema } from "@/lib/ai/schema";
import { POST } from "../route";

describe("AI chat request body size", () => {
	it("is allowed to carry the images the schema accepts, not the 1 MiB default", async () => {
		// Images and PDFs travel as base64 in the JSON body; the default limit refused every real screenshot.
		await POST(new Request("https://hub.test/api/ai/chat", { method: "POST", body: "{}" }));
		const options = guard.options.at(-1)!;
		expect(options.bodySchema).toBe(chatRequestSchema);
		expect(options.maxBodyBytes).toBeGreaterThanOrEqual(24 * 1024 * 1024);
	});
});
