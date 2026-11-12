// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getPlatformDefaults: vi.fn(),
	requireApiSession: vi.fn(),
	withRateLimit: vi.fn(),
}));

vi.mock("@/lib/settings/platform-defaults", () => ({ getPlatformDefaults: mocks.getPlatformDefaults }));
vi.mock("@/lib/auth/api-session", () => ({ requireApiSession: mocks.requireApiSession, isSessionPayload: () => true }));
vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: vi.fn() }));
vi.mock("@/lib/auth/bearer-token", () => ({ hasBearerAuthorization: () => false, authenticateBearerForPermissions: vi.fn() }));
vi.mock("@/lib/http/rate-limit-presets", async () => {
	const actual = await vi.importActual<typeof import("@/lib/http/rate-limit-presets")>("@/lib/http/rate-limit-presets");
	return { ...actual, withRateLimit: mocks.withRateLimit };
});

const { requestLocale } = await import("../request-locale");
const { withApiRoute } = await import("../api-guard");
const { apiCopy, withApiCopyLocale } = await import("@/lib/i18n/api-copy");
const { getServerLocale } = await import("@/lib/i18n/server-locale-cookie");
const { serviceTranslations, t } = await import("@/lib/i18n/service-translations");

const SERVICE_KEY = "backend.request.bodyTooLarge";
const API_KEY = "apiCopy.files.op.missing";

function request(headers: Record<string, string> = {}) {
	return new Request("https://hub.example/api/demo", { headers });
}

const platform = (locale: "zh" | "en") => mocks.getPlatformDefaults.mockResolvedValue({ locale, theme: "dark" });

beforeEach(() => {
	vi.clearAllMocks();
	platform("zh");
	mocks.requireApiSession.mockResolvedValue({ userId: "u1", username: "alice", roles: ["admin"] });
	mocks.withRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0, remaining: 1 });
});

describe("the language a request is answered in", () => {
	it.each(["en", "zh"] as const)("is the one chosen on the page (%s), whatever the platform and the browser say", async (chosen) => {
		platform(chosen === "en" ? "zh" : "en");
		const other = chosen === "en" ? "zh-CN" : "en-US";

		expect(await requestLocale(request({ cookie: `a=1; vps-locale=${chosen}`, "accept-language": other, "sec-fetch-site": "same-origin" }))).toBe(chosen);
		expect(mocks.getPlatformDefaults).not.toHaveBeenCalled();
	});

	// The pages of a browser that never switched are shown in the platform's default language. Its API
	// messages went by Accept-Language: English errors on Chinese pages, and the reverse.
	it.each([
		["zh", "en-US,en;q=0.9"],
		["en", "zh-CN,zh;q=0.9"],
	] as const)("is the platform's default (%s) for a page that never chose, not the browser's %s", async (locale, acceptLanguage) => {
		platform(locale);

		expect(await requestLocale(request({ "sec-fetch-site": "same-origin", "accept-language": acceptLanguage }))).toBe(locale);
	});

	it("takes a browser without fetch metadata by the cookies it sends", async () => {
		platform("en");

		expect(await requestLocale(request({ cookie: "vcontrolhub_session=abc", "accept-language": "zh-CN" }))).toBe("en");
	});

	it.each([
		[{ "accept-language": "zh-CN,zh;q=0.9" }, "zh"],
		[{ "accept-language": "zh" }, "zh"],
		[{ "accept-language": "en-US" }, "en"],
		[{}, "en"],
		// A token client that also replays cookies is still a script.
		[{ authorization: "Bearer vch_token", cookie: "x=1" }, "en"],
		[{ authorization: "Bearer vch_token", "accept-language": "zh-TW" }, "zh"],
		// Another site's page is not ours.
		[{ "sec-fetch-site": "cross-site", "accept-language": "zh-CN" }, "zh"],
	] as const)("goes by Accept-Language, then English, for a script (%o)", async (headers, expected) => {
		platform(expected === "zh" ? "en" : "zh");

		expect(await requestLocale(request(headers))).toBe(expected);
		expect(mocks.getPlatformDefaults).not.toHaveBeenCalled();
	});
});

describe("an API route speaks one language per request", () => {
	async function spoken(headers: Record<string, string>) {
		const response = await withApiRoute(request(headers), { requireAuth: true }, async () =>
			Response.json({ api: apiCopy(API_KEY), service: t(SERVICE_KEY), server: await getServerLocale() }),
		);
		return response.json() as Promise<{ api: string; service: string; server: string }>;
	}

	it("the platform's for a page that never chose", async () => {
		platform("zh");

		expect(await spoken({ "sec-fetch-site": "same-origin", "accept-language": "en-US" })).toEqual({
			api: withApiCopyLocale("zh", () => apiCopy(API_KEY)),
			service: serviceTranslations.zh[SERVICE_KEY],
			server: "zh",
		});
	});

	// Routes that asked for "the server locale" got the platform default while the wrapper around them
	// spoke Accept-Language: two languages in one answer for a token client.
	it("the script's own for a token client, also where a route asks for the server locale", async () => {
		platform("zh");

		expect(await spoken({ "accept-language": "en-US" })).toEqual({
			api: withApiCopyLocale("en", () => apiCopy(API_KEY)),
			service: serviceTranslations.en[SERVICE_KEY],
			server: "en",
		});
	});

	it("words its rate limit refusal in that language", async () => {
		mocks.withRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 1_500, remaining: 0 });
		const refused = async (headers: Record<string, string>) => {
			const response = await withApiRoute(request(headers), { requireAuth: true, rateLimit: { maxRequests: 1, windowMs: 1_000 } }, async () => Response.json({}));
			expect(response.status).toBe(429);
			expect(response.headers.get("Retry-After")).toBe("2");
			return ((await response.json()) as { message: string }).message;
		};

		expect(await refused({ cookie: "vps-locale=zh" })).toBe("请求过于频繁，请稍后再试");
		expect(await refused({ cookie: "vps-locale=en" })).toBe("Too many requests; please try again later");
	});
});
