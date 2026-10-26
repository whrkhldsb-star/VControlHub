// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const getSetting = vi.hoisted(() => vi.fn<(key: string) => Promise<string>>());
vi.mock("@/lib/settings/service", () => ({ getSetting }));

import { checkTurnstileSecret, getTurnstileConfig, verifyTurnstileToken } from "@/lib/auth/turnstile";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("Cloudflare Turnstile", () => {
	afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); getSetting.mockReset(); });

	it("is on only with both keys, and TURNSTILE_DISABLED turns it off without the database", async () => {
		getSetting.mockImplementation(async (key) => (key === "security.turnstileSiteKey" ? " 0xSITE " : "0xSECRET"));
		expect(await getTurnstileConfig()).toEqual({ siteKey: "0xSITE", secretKey: "0xSECRET" });
		getSetting.mockImplementation(async (key) => (key === "security.turnstileSiteKey" ? "0xSITE" : ""));
		expect(await getTurnstileConfig()).toBeNull();
		getSetting.mockResolvedValue("0xBOTH");
		vi.stubEnv("TURNSTILE_DISABLED", "true");
		expect(await getTurnstileConfig()).toBeNull();
	});

	it("takes Cloudflare's verdict on a token, and refuses a missing one without asking", async () => {
		const fetch = vi.fn().mockResolvedValueOnce(reply({ success: true })).mockResolvedValueOnce(reply({ success: false, "error-codes": ["invalid-input-response"] }));
		vi.stubGlobal("fetch", fetch);
		const config = { siteKey: "s", secretKey: "k" };
		expect(await verifyTurnstileToken(config, "good", "203.0.113.9")).toEqual({ ok: true });
		expect(await verifyTurnstileToken(config, "bad")).toEqual({ ok: false, reason: "invalid-input-response" });
		expect(await verifyTurnstileToken(config, "")).toEqual({ ok: false, reason: "missing-input-response" });
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("lets a login through to the password checks, flagged, while Cloudflare cannot be reached", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({}, 502)).mockRejectedValueOnce(new Error("ETIMEDOUT")));
		const config = { siteKey: "s", secretKey: "k" };
		expect(await verifyTurnstileToken(config, "t")).toEqual({ ok: true, unverified: true });
		expect(await verifyTurnstileToken(config, "t")).toEqual({ ok: true, unverified: true });
	});

	it("tells a secret Cloudflare does not know before it is saved", async () => {
		vi.stubGlobal("fetch", vi.fn()
			.mockResolvedValueOnce(reply({ success: false, "error-codes": ["invalid-input-secret"] }))
			.mockResolvedValueOnce(reply({ success: false, "error-codes": ["invalid-input-response"] }))
			.mockRejectedValueOnce(new Error("offline")));
		expect(await checkTurnstileSecret("wrong")).toBe("invalid-secret");
		expect(await checkTurnstileSecret("right")).toBeNull();
		expect(await checkTurnstileSecret("unknown")).toBeNull();
	});
});
