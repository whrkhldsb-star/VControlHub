import { describe, expect, it, vi } from "vitest";

/**
 * The language of a refusal on the public share route. The route is not behind withApiRoute, and the share service
 * words its refusals with the backend copy: with no language set for it, a visitor of an English installation was
 * told "访问密码错误".
 */
const getServerLocaleMock = vi.hoisted(() => vi.fn(async (): Promise<"zh" | "en"> => "zh"));
vi.mock("@/lib/i18n/server-locale-cookie", () => ({ getServerLocale: getServerLocaleMock }));
vi.mock("@/lib/share-link/service", () => ({
  authorizeShareDownload: vi.fn(),
  assertShareTargetNotDeleted: vi.fn(async () => undefined),
  hashShareToken: vi.fn((token: string) => `hash:${token}`),
  normalizeSharePath: vi.fn((value: string) => value.replace(/^\/+/, "")),
  releaseShareQuotaClaim: vi.fn(async () => undefined),
  resolveShareToken: vi.fn(),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
}));

const { ForbiddenError, ValidationError } = await import("@/lib/errors");
const { t } = await import("@/lib/i18n/service-translations");
const { authorizeShareDownload, resolveShareToken } = await import("@/lib/share-link/service");
const route = await import("../route");

const params = { params: Promise.resolve({ token: "public-share-token-12345" }) };
const unlock = () => route.POST(new Request("http://local/api/share/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) }), params);

describe("public share route language", () => {
  // As the real service does it: the text is looked up when the refusal is thrown.
  vi.mocked(authorizeShareDownload).mockImplementation(async () => { throw new ValidationError(t("backend.shareLink.passwordIncorrect")); });
  vi.mocked(resolveShareToken).mockImplementation(async () => { throw new ForbiddenError(t("backend.shareLink.previewOnly")); });

  it("words the service's refusals in the visitor's language", async () => {
    getServerLocaleMock.mockResolvedValue("en");
    expect((await (await unlock()).json()).message).toBe("Incorrect access password");
    const download = await route.GET(new Request("http://local/api/share/x"), params);
    expect(download.status).toBe(403);
    expect((await download.json()).message).toBe(t("backend.shareLink.previewOnly", "en"));

    getServerLocaleMock.mockResolvedValue("zh");
    expect((await (await unlock()).json()).message).toBe("访问密码错误");
  });
});
